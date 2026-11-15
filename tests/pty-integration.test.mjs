import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PtyExecutionService, CircularOutputBuffer } from '../src/main/pty-service.js';

class MockPtyProcess extends EventEmitter {
  constructor({ pid = 1234 } = {}) {
    super();
    this.pid = pid;
    this.writes = [];
    this.resizes = [];
    this.killed = false;
  }

  write(data) {
    this.writes.push(data);
  }

  resize(cols, rows) {
    this.resizes.push({ cols, rows });
  }

  kill(signal) {
    this.killed = true;
    this.emit('exit', { exitCode: 0, signal: signal || 'SIGHUP' });
  }

  onData(cb) {
    this.on('data', cb);
  }

  onExit(cb) {
    this.on('exit', cb);
  }
}

class MockPtyModule {
  constructor() {
    this.spawnCount = 0;
    this.lastSpawn = null;
    this.activeProcess = null;
  }

  spawn(file, args, options) {
    this.spawnCount++;
    this.lastSpawn = { file, args, options };
    this.activeProcess = new MockPtyProcess({ pid: 4321 + this.spawnCount });
    return this.activeProcess;
  }
}

class MockWebContents extends EventEmitter {
  constructor(id = 1) {
    super();
    this.id = id;
    this._destroyed = false;
    this.sent = [];
  }

  isDestroyed() {
    return this._destroyed;
  }

  destroy() {
    this._destroyed = true;
    this.emit('destroyed');
  }

  send(channel, payload) {
    this.sent.push({ channel, payload });
  }
}

// Emulate IPC harness matching main.js handlers
function createIpcHarness({ mockPty } = {}) {
  const ptyModule = mockPty || new MockPtyModule();
  const service = new PtyExecutionService({
    pty: ptyModule,
    readSettings: () => ({ theme: 'dark' }),
    platform: 'win32',
    env: { PATH: 'C:\\Windows' },
    homedir: 'C:\\Users\\test',
  });

  const sessionOwners = new Map();

  function bindRendererEvents(svc, id, wc) {
    let unsub = null;
    const onDestroy = () => {
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (sessionOwners.get(id) === wc.id) {
        sessionOwners.delete(id);
      }
    };

    unsub = svc.subscribe(id, (ev) => {
      if (wc.isDestroyed()) {
        onDestroy();
        return;
      }
      if (ev.type === 'data') {
        wc.send('term:data', { id, data: ev.data, seq: ev.seq });
      } else if (ev.type === 'exit') {
        sessionOwners.delete(id);
        wc.send('term:exit', { id, code: ev.code, signal: ev.signal, deliberate: ev.deliberate, note: ev.note });
      } else if (ev.type === 'command-done') {
        wc.send('term:command-done', { id, code: ev.code });
      } else if (ev.type === 'title') {
        wc.send('session:title', { id, title: ev.title });
      } else if (ev.type === 'sid') {
        wc.send('term:session-id', { id, sid: ev.sid });
      }
    });

    if (wc.once) {
      wc.once('destroyed', onDestroy);
    }

    return () => {
      if (wc.removeListener) {
        try { wc.removeListener('destroyed', onDestroy); } catch (_) {}
      }
      onDestroy();
    };
  }

  const handlers = {
    'term:create': async (wc, args) => {
      const { id } = args;
      service.unsubscribeAll(id);
      sessionOwners.set(id, wc.id);

      const unsub = bindRendererEvents(service, id, wc);
      const res = await service.create(args);
      if (!res || !res.ok) {
        unsub();
        sessionOwners.delete(id);
      }
      return res;
    },

    'term:attach': async (wc, { id, fromSeq = 0 }) => {
      if (!service.hasSession(id) && !service.getExitedSession(id)) {
        return { ok: false, error: 'session not found' };
      }
      service.unsubscribeAll(id);
      sessionOwners.set(id, wc.id);

      bindRendererEvents(service, id, wc);
      const replay = service.replay(id, fromSeq);
      return {
        ok: true,
        active: service.hasSession(id),
        earliestSeq: replay.earliestSeq,
        nextSeq: replay.nextSeq,
        chunks: replay.chunks,
      };
    },

    'term:write': async (_wc, { id, data }) => {
      if (service.hasSession(id)) {
        return { ok: service.write(id, data) };
      }
      return { ok: false };
    },

    'term:resize': async (_wc, { id, cols, rows }) => {
      if (service.hasSession(id)) {
        return { ok: service.resize(id, cols, rows) };
      }
      return { ok: false };
    },

    'term:kill': async (_wc, { id }) => {
      sessionOwners.delete(id);
      if (service.hasSession(id)) {
        return { ok: service.kill(id) };
      }
      return { ok: false };
    },

    'term:replay': async (_wc, { id, fromSeq = 0 }) => {
      return service.replay(id, fromSeq);
    },

    reapSessions: (wcId) => {
      for (const [id, owner] of [...sessionOwners]) {
        if (owner !== wcId) continue;
        sessionOwners.delete(id);
        service.unsubscribeAll(id);
      }
    },
  };

  return { service, ptyModule, sessionOwners, handlers };
}

test('integration: term:create creates a session owned by PtyExecutionService and routes streaming with sequence numbers', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc1 = new MockWebContents(101);

  const res = await handlers['term:create'](wc1, {
    id: 'sess-1',
    cwd: 'C:\\Users\\test\\project',
    cols: 80,
    rows: 24,
    kind: 'shell',
  });

  assert.equal(res.ok, true);
  assert.equal(service.sessionCount, 1);
  assert.equal(service.hasSession('sess-1'), true);
  assert.equal(ptyModule.spawnCount, 1);

  const proc = ptyModule.activeProcess;
  assert.ok(proc);

  // Emit data from process
  proc.emit('data', 'hello world');
  assert.equal(wc1.sent.length, 1);
  assert.equal(wc1.sent[0].channel, 'term:data');
  assert.equal(wc1.sent[0].payload.data, 'hello world');
  assert.equal(wc1.sent[0].payload.seq, 1);

  // Verify buffer received the data
  const replay = await handlers['term:replay'](wc1, { id: 'sess-1', fromSeq: 0 });
  assert.equal(replay.chunks.length, 1);
  assert.equal(replay.chunks[0].data, 'hello world');
  assert.equal(replay.chunks[0].seq, 1);
});

test('integration: failed term:create cleans up subscription and sessionOwners', async () => {
  const mockPty = {
    spawn: () => {
      throw new Error('spawn failure simulation');
    },
  };
  const { service, sessionOwners, handlers } = createIpcHarness({ mockPty });
  const wc = new MockWebContents(102);

  const res = await handlers['term:create'](wc, { id: 'fail-sess', kind: 'shell' });
  assert.equal(res.ok, false);
  assert.equal(service.hasSession('fail-sess'), false);
  assert.equal(sessionOwners.has('fail-sess'), false);
  // Unsubscribed: service has no listeners for fail-sess
  assert.equal(service._subscribers.has('fail-sess'), false);
});

test('integration: explicit term:attach reconnection lifecycle without spawning a second PTY', async () => {
  const { service, ptyModule, sessionOwners, handlers } = createIpcHarness();

  // 1. Create a session with first renderer
  const wc1 = new MockWebContents(101);
  const createRes = await handlers['term:create'](wc1, {
    id: 'sess-attach-test',
    kind: 'shell',
  });
  assert.equal(createRes.ok, true);
  assert.equal(ptyModule.spawnCount, 1);
  assert.equal(sessionOwners.get('sess-attach-test'), 101);

  const proc = ptyModule.activeProcess;
  proc.emit('data', 'initial banner\r\n');
  assert.equal(wc1.sent.length, 1);
  assert.equal(wc1.sent[0].payload.data, 'initial banner\r\n');
  assert.equal(wc1.sent[0].payload.seq, 1);

  // 2. Disconnect renderer wc1
  wc1.destroy();
  handlers.reapSessions(101);
  assert.equal(sessionOwners.has('sess-attach-test'), false);
  assert.equal(service._subscribers.has('sess-attach-test'), false);

  // 3. Continue writing output while disconnected
  proc.emit('data', 'background job chunk 1\r\n');
  proc.emit('data', 'background job chunk 2\r\n');
  assert.equal(wc1.sent.length, 1); // No deliveries to disconnected window

  // 4. Attach a new renderer wc2 using the same session ID
  const wc2 = new MockWebContents(202);
  const attachRes = await handlers['term:attach'](wc2, { id: 'sess-attach-test', fromSeq: 1 });

  // Verify attach response
  assert.equal(attachRes.ok, true);
  assert.equal(attachRes.active, true);
  assert.equal(sessionOwners.get('sess-attach-test'), 202);

  // 5. Verify replay contains missed output
  assert.equal(attachRes.chunks.length, 3);
  assert.deepEqual(attachRes.chunks.map(c => c.data), [
    'initial banner\r\n',
    'background job chunk 1\r\n',
    'background job chunk 2\r\n',
  ]);
  assert.deepEqual(attachRes.chunks.map(c => c.seq), [1, 2, 3]);

  // 6. Verify NO second PTY is spawned
  assert.equal(ptyModule.spawnCount, 1);

  // 7. Verify new output arrives live after attachment
  proc.emit('data', 'live post-attach chunk\r\n');
  assert.equal(wc2.sent.length, 1);
  assert.equal(wc2.sent[0].channel, 'term:data');
  assert.equal(wc2.sent[0].payload.data, 'live post-attach chunk\r\n');
  assert.equal(wc2.sent[0].payload.seq, 4);

  // 8. Verify writes, resize and kill work from the attached renderer
  const writeRes = await handlers['term:write'](wc2, { id: 'sess-attach-test', data: 'ls -la\r' });
  assert.equal(writeRes.ok, true);
  assert.equal(proc.writes[0], 'ls -la\r');

  const resizeRes = await handlers['term:resize'](wc2, { id: 'sess-attach-test', cols: 120, rows: 40 });
  assert.equal(resizeRes.ok, true);
  assert.deepEqual(proc.resizes[0], { cols: 120, rows: 40 });

  const killRes = await handlers['term:kill'](wc2, { id: 'sess-attach-test' });
  assert.equal(killRes.ok, true);
  assert.equal(proc.killed, true);
  assert.equal(service.hasSession('sess-attach-test'), false);
  assert.equal(sessionOwners.has('sess-attach-test'), false);
});

test('integration: live output emitted concurrently during term:attach is correctly sequenced without duplicates', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();

  // Create session
  const wc1 = new MockWebContents(101);
  await handlers['term:create'](wc1, { id: 'sess-race-test', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Emit 2 initial chunks while wc1 is connected
  proc.emit('data', 'chunk 1\r\n'); // seq 1
  proc.emit('data', 'chunk 2\r\n'); // seq 2

  // Renderer 1 closes / disconnects
  wc1.destroy();
  handlers.reapSessions(101);

  // Client terminal consumer model:
  // During attachment, the renderer starts receiving live events while awaiting the attach/replay promise.
  // Using seq tracking and initial queueing/deduping, the terminal stream stays in strict order without duplicates.
  class TerminalClient {
    constructor() {
      this.lastSeenSeq = 0;
      this.receivedStream = [];
      this.isReplaying = true;
      this.liveQueue = [];
    }

    onLiveChunk(seq, data) {
      if (this.isReplaying) {
        this.liveQueue.push({ seq, data });
        return;
      }
      this.applyChunk(seq, data);
    }

    applyChunk(seq, data) {
      if (seq <= this.lastSeenSeq) {
        // Drop duplicate chunks already applied from replay
        return;
      }
      this.receivedStream.push({ seq, data });
      this.lastSeenSeq = seq;
    }

    applyReplay(chunks) {
      for (const c of chunks) {
        this.applyChunk(c.seq, c.data);
      }
      this.isReplaying = false;
      // Drain any live chunks queued during replay retrieval
      for (const live of this.liveQueue) {
        this.applyChunk(live.seq, live.data);
      }
      this.liveQueue = [];
    }
  }

  const client = new TerminalClient();
  const wc2 = new MockWebContents(202);

  wc2.send = (channel, payload) => {
    if (channel === 'term:data') {
      client.onLiveChunk(payload.seq, payload.data);
    }
  };

  // Attach begins: subscribe wc2
  service.unsubscribeAll('sess-race-test');
  const unsub = service.subscribe('sess-race-test', (ev) => {
    if (ev.type === 'data') {
      wc2.send('term:data', { id: 'sess-race-test', data: ev.data, seq: ev.seq });
    }
  });

  // Replay fetched by attach handler: chunks 1 & 2
  const replay = service.replay('sess-race-test', 1);

  // RACE: PTY emits output right before IPC replay response is processed by renderer!
  proc.emit('data', 'concurrent chunk 3\r\n'); // seq 3 arrives live at wc2

  // Renderer receives attach response and applies replay
  client.applyReplay(replay.chunks);

  // Further live output arrives afterwards
  proc.emit('data', 'post-attach chunk 4\r\n'); // seq 4

  // Verify the resulting terminal stream contains each chunk exactly once and in strict sequence
  assert.equal(client.receivedStream.length, 4);
  assert.deepEqual(client.receivedStream.map(c => c.seq), [1, 2, 3, 4]);
  assert.deepEqual(client.receivedStream.map(c => c.data), [
    'chunk 1\r\n',
    'chunk 2\r\n',
    'concurrent chunk 3\r\n',
    'post-attach chunk 4\r\n',
  ]);

  unsub();
});

test('integration: attach rejection or failure falls back cleanly without leaving started stuck', async () => {
  const { service, handlers } = createIpcHarness();
  const wc = new MockWebContents(106);

  // Simulated renderer panel state
  const panel = {
    id: 'non-existent-session',
    kind: 'shell',
    started: false,
    lastSeenSeq: 0,
    queuedData: [],
  };

  // Emulate renderer startProcess fallback logic
  async function simulateStartProcess(p) {
    if (p.started) return;
    p.started = true;
    p.isAttaching = true;

    try {
      const attached = await handlers['term:attach'](wc, { id: p.id, fromSeq: p.lastSeenSeq + 1 });
      if (attached && attached.ok) {
        return { attached: true };
      }
    } catch (_) {
      // Rejection branch
    } finally {
      p.isAttaching = false;
    }

    // Fallback to term:create
    try {
      const created = await handlers['term:create'](wc, { id: p.id, kind: p.kind });
      if (!created || !created.ok) {
        p.started = false;
        return { created: false };
      }
      return { created: true };
    } catch (err) {
      p.started = false;
      throw err;
    }
  }

  // 1. Session does not exist yet -> attach fails cleanly -> falls back to term:create
  const res = await simulateStartProcess(panel);
  assert.equal(res.created, true);
  assert.equal(panel.started, true);
  assert.equal(service.hasSession('non-existent-session'), true);

  // 2. Test when term:create fails -> verify p.started is reset to false
  const failingPanel = {
    id: 'failing-create-session',
    kind: 'shell',
    started: false,
    lastSeenSeq: 0,
    queuedData: [],
  };

  // Mock service spawn failure
  service._pty = { spawn: () => { throw new Error('simulated spawn failure'); } };
  const failRes = await simulateStartProcess(failingPanel);
  assert.equal(failRes.created, false);
  assert.equal(failingPanel.started, false); // verify p.started is not left stuck true
});

test('integration: sequence gap in live stream triggers term:replay and serializes stream correctly', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(107);

  await handlers['term:create'](wc, { id: 'sess-gap-test', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Emulate renderer state and handlers
  const panel = {
    id: 'sess-gap-test',
    lastSeenSeq: 0,
    isReplaying: false,
    received: [],
  };

  function applyChunks(chunks) {
    for (const c of chunks) {
      if (c && c.data && c.seq > panel.lastSeenSeq) {
        panel.received.push({ seq: c.seq, data: c.data });
        panel.lastSeenSeq = c.seq;
      }
    }
  }

  async function onTermData({ seq, data }) {
    if (seq <= panel.lastSeenSeq) return; // Drop duplicate
    if (seq > panel.lastSeenSeq + 1 && !panel.isReplaying) {
      // Sequence gap detected: fetch missing from expected sequence
      panel.isReplaying = true;
      const replay = await handlers['term:replay'](wc, { id: panel.id, fromSeq: panel.lastSeenSeq + 1 });
      if (replay && Array.isArray(replay.chunks)) {
        applyChunks(replay.chunks);
      }
      panel.isReplaying = false;
    }
    if (seq > panel.lastSeenSeq) {
      panel.received.push({ seq, data });
      panel.lastSeenSeq = seq;
    }
  }

  // Generate chunks 1, 2, 3 in service buffer
  proc.emit('data', 'chunk 1\r\n'); // seq 1
  proc.emit('data', 'chunk 2\r\n'); // seq 2
  proc.emit('data', 'chunk 3\r\n'); // seq 3

  // Client directly receives chunk 1
  await onTermData({ seq: 1, data: 'chunk 1\r\n' });
  assert.equal(panel.lastSeenSeq, 1);

  // Client artificially misses chunk 2 and receives chunk 3 (gap: expected 2, got 3)
  await onTermData({ seq: 3, data: 'chunk 3\r\n' });

  // Verify gap was filled via term:replay and chunks are serialized in exact sequence [1, 2, 3]
  assert.equal(panel.received.length, 3);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2, 3]);
  assert.deepEqual(panel.received.map(c => c.data), ['chunk 1\r\n', 'chunk 2\r\n', 'chunk 3\r\n']);
});

test('integration: two consecutive live chunks arriving while gap recovery is pending are strictly serialized', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(108);

  await handlers['term:create'](wc, { id: 'sess-consec-gap-test', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  const panel = {
    id: 'sess-consec-gap-test',
    lastSeenSeq: 0,
    dataQueue: Promise.resolve(),
    received: [],
  };

  function applyChunks(p, chunks) {
    for (const c of chunks) {
      if (c && c.data && c.seq > p.lastSeenSeq) {
        p.received.push({ seq: c.seq, data: c.data });
        p.lastSeenSeq = c.seq;
      }
    }
  }

  async function processEvent(p, { seq, data }) {
    if (seq <= p.lastSeenSeq) return;
    const expected = p.lastSeenSeq + 1;
    if (seq > expected) {
      const replay = await handlers['term:replay'](wc, { id: p.id, fromSeq: expected });
      if (replay && Array.isArray(replay.chunks)) {
        applyChunks(p, replay.chunks);
      }
    }
    if (seq <= p.lastSeenSeq) return;
    p.received.push({ seq, data });
    p.lastSeenSeq = seq;
  }

  function onTermData(p, event) {
    p.dataQueue = p.dataQueue
      .then(() => processEvent(p, event))
      .catch(() => {});
  }

  // Chunks 1 to 5 generated by PTY
  proc.emit('data', 'chunk 1\r\n'); // seq 1
  proc.emit('data', 'chunk 2\r\n'); // seq 2
  proc.emit('data', 'chunk 3\r\n'); // seq 3
  proc.emit('data', 'chunk 4\r\n'); // seq 4
  proc.emit('data', 'chunk 5\r\n'); // seq 5

  // Initial event delivered
  onTermData(panel, { seq: 1, data: 'chunk 1\r\n' });

  // Now, chunk 2 is skipped. Chunk 3 and Chunk 4 arrive back-to-back concurrently
  // while gap recovery for chunk 2 is still in-flight!
  onTermData(panel, { seq: 3, data: 'chunk 3\r\n' });
  onTermData(panel, { seq: 4, data: 'chunk 4\r\n' });
  onTermData(panel, { seq: 5, data: 'chunk 5\r\n' });

  // Await the FIFO promise queue to settle
  await panel.dataQueue;

  // Verify all chunks are written strictly in monotonic sequence [1, 2, 3, 4, 5] without duplicates
  assert.equal(panel.received.length, 5);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2, 3, 4, 5]);
  assert.deepEqual(panel.received.map(c => c.data), [
    'chunk 1\r\n',
    'chunk 2\r\n',
    'chunk 3\r\n',
    'chunk 4\r\n',
    'chunk 5\r\n',
  ]);
});

test('integration: restored panel with lastSeenSeq=500 resets to 0 on fresh PTY fallback and accepts first chunk', async () => {
  const { service, handlers } = createIpcHarness();
  const wc = new MockWebContents(109);

  // A restored panel from previous boot where lastSeenSeq was 500
  const panel = {
    id: 'restored-old-panel',
    kind: 'shell',
    started: false,
    lastSeenSeq: 500,
    queuedData: [{ data: 'stale old data', seq: 499 }],
  };

  // Execute startProcess logic
  async function simulateStartProcess(p) {
    if (p.started) return;
    p.started = true;
    p.queuedData = p.queuedData || [];

    if (handlers['term:attach']) {
      p.isAttaching = true;
      try {
        const attached = await handlers['term:attach'](wc, { id: p.id, fromSeq: p.lastSeenSeq + 1 });
        if (attached && attached.ok) {
          return { attached: true };
        }
      } catch (_) {
      } finally {
        p.isAttaching = false;
      }
    }

    // Fresh fallback to term:create
    const created = await handlers['term:create'](wc, { id: p.id, kind: p.kind });
    if (!created || !created.ok) {
      p.started = false;
      return { created: false };
    }

    // Sequence state MUST reset to 0 for a genuinely new PTY
    p.lastSeenSeq = 0;
    p.queuedData = [];
    return { created: true };
  }

  const res = await simulateStartProcess(panel);
  assert.equal(res.created, true);
  assert.equal(panel.lastSeenSeq, 0);
  assert.deepEqual(panel.queuedData, []);

  // Now the new session's first output chunk (seq 1) arrives
  const received = [];
  function onData(p, event) {
    if (event.seq <= p.lastSeenSeq) return;
    received.push(event);
    p.lastSeenSeq = event.seq;
  }

  onData(panel, { seq: 1, data: 'brand new pty output\r\n' });

  // Verify the new session's first output chunk (seq 1) is accepted and not dropped
  assert.equal(received.length, 1);
  assert.equal(received[0].seq, 1);
  assert.equal(received[0].data, 'brand new pty output\r\n');
  assert.equal(panel.lastSeenSeq, 1);
});

test('integration: new live event arriving during attach replay drain is ordered strictly behind replay', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(110);

  await handlers['term:create'](wc, { id: 'sess-attach-drain-order', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Emit 2 initial chunks (seq 1, 2)
  proc.emit('data', 'chunk 1\r\n');
  proc.emit('data', 'chunk 2\r\n');

  // Client disconnects
  wc.destroy();
  handlers.reapSessions(110);

  // New renderer wc2 connects
  const wc2 = new MockWebContents(210);
  const panel = {
    id: 'sess-attach-drain-order',
    lastSeenSeq: 0,
    dataQueue: Promise.resolve(),
    received: [],
  };

  async function processEvent(p, { seq, data }) {
    if (typeof seq === 'number') {
      if (seq <= p.lastSeenSeq) return;
      const expected = p.lastSeenSeq + 1;
      if (seq > expected) {
        const replay = await handlers['term:replay'](wc2, { id: p.id, fromSeq: expected });
        if (replay && Array.isArray(replay.chunks)) {
          for (const c of replay.chunks) {
            if (c.seq > p.lastSeenSeq) {
              p.received.push({ seq: c.seq, data: c.data });
              p.lastSeenSeq = c.seq;
            }
          }
        }
      }
      if (seq > p.lastSeenSeq + 1) return;
      if (seq <= p.lastSeenSeq) return;
      p.lastSeenSeq = seq;
    }
    p.received.push({ seq, data });
  }

  function queueEvent(p, event) {
    p.dataQueue = p.dataQueue.then(() => processEvent(p, event)).catch(() => {});
  }

  // Hook live term:data stream
  wc2.send = (channel, payload) => {
    if (channel === 'term:data') {
      queueEvent(panel, { seq: payload.seq, data: payload.data });
    }
  };

  // Start attach
  const attached = await handlers['term:attach'](wc2, { id: panel.id, fromSeq: 1 });
  assert.equal(attached.ok, true);

  // Enqueue replay into dataQueue as implemented in startProcess
  panel.dataQueue = panel.dataQueue.then(() => {
    for (const c of attached.chunks) {
      if (c.seq > panel.lastSeenSeq) {
        panel.received.push({ seq: c.seq, data: c.data });
        panel.lastSeenSeq = c.seq;
      }
    }
  });

  // Concurrent live chunks (seq 3, 4) arrive immediately from PTY
  proc.emit('data', 'chunk 3\r\n');
  proc.emit('data', 'chunk 4\r\n');

  // Await the pipeline to settle
  await panel.dataQueue;

  // Verify exact ordering: [1, 2] from attach replay, followed by [3, 4] from live stream
  assert.equal(panel.received.length, 4);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2, 3, 4]);
  assert.deepEqual(panel.received.map(c => c.data), [
    'chunk 1\r\n',
    'chunk 2\r\n',
    'chunk 3\r\n',
    'chunk 4\r\n',
  ]);
});

test('integration: replay failure or incomplete range holds chunk without advancing lastSeenSeq', async () => {
  const wc = new MockWebContents(111);
  const panel = {
    id: 'sess-incomplete-replay',
    lastSeenSeq: 1,
    dataQueue: Promise.resolve(),
    received: [{ seq: 1, data: 'chunk 1\r\n' }],
  };

  let replayBehavior = 'throw'; // 'throw' | 'incomplete' | 'complete'

  const mockApi = {
    termReplay: async ({ fromSeq }) => {
      if (replayBehavior === 'throw') {
        throw new Error('network/ipc transport error');
      }
      if (replayBehavior === 'incomplete') {
        // Gap is 2..4, but replay only returns chunk 2
        return { chunks: [{ seq: 2, data: 'chunk 2\r\n' }] };
      }
      if (replayBehavior === 'complete') {
        return { chunks: [{ seq: 3, data: 'chunk 3\r\n' }] };
      }
      return { chunks: [] };
    },
  };

  async function processEvent(p, { seq, data }) {
    if (typeof seq === 'number') {
      if (seq <= p.lastSeenSeq) return;
      const expected = p.lastSeenSeq + 1;
      if (seq > expected) {
        try {
          const replay = await mockApi.termReplay({ fromSeq: expected });
          if (replay && Array.isArray(replay.chunks)) {
            for (const c of replay.chunks) {
              if (c.seq > p.lastSeenSeq) {
                p.received.push({ seq: c.seq, data: c.data });
                p.lastSeenSeq = c.seq;
              }
            }
          }
        } catch (_) {}

        // If gap is not fully closed, do NOT advance or write later chunk
        if (seq > p.lastSeenSeq + 1) {
          return;
        }
        if (seq <= p.lastSeenSeq) return;
      }
      p.lastSeenSeq = seq;
    }
    p.received.push({ seq, data });
  }

  function queueEvent(p, event) {
    p.dataQueue = p.dataQueue.then(() => processEvent(p, event)).catch(() => {});
  }

  // 1. Replay throws an error on seq 4 gap
  replayBehavior = 'throw';
  queueEvent(panel, { seq: 4, data: 'chunk 4\r\n' });
  await panel.dataQueue;

  // Chunk 4 MUST NOT be written and lastSeenSeq MUST NOT advance to 4
  assert.equal(panel.lastSeenSeq, 1);
  assert.equal(panel.received.length, 1);

  // 2. Replay returns an incomplete range (returns chunk 2 only; chunk 3 still missing)
  replayBehavior = 'incomplete';
  queueEvent(panel, { seq: 4, data: 'chunk 4\r\n' });
  await panel.dataQueue;

  // Chunk 2 was written, but chunk 3 is still missing, so chunk 4 MUST NOT be written yet
  assert.equal(panel.lastSeenSeq, 2);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2]);

  // 3. Seq 5 arrives while chunk 3 is still missing — later events CANNOT overtake earlier gap
  queueEvent(panel, { seq: 5, data: 'chunk 5\r\n' });
  await panel.dataQueue;
  assert.equal(panel.lastSeenSeq, 2);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2]);

  // 4. Replay successfully completes chunk 3
  replayBehavior = 'complete';
  queueEvent(panel, { seq: 4, data: 'chunk 4\r\n' });
  await panel.dataQueue;

  // Now chunks 3 and 4 are safely accepted in order
  assert.equal(panel.lastSeenSeq, 4);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2, 3, 4]);
});

test('integration: live event arriving BEFORE termAttach resolves is buffered and drained in sequence', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(112);

  await handlers['term:create'](wc, { id: 'sess-pre-attach-live', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Emit initial chunks 1 and 2
  proc.emit('data', 'chunk 1\r\n');
  proc.emit('data', 'chunk 2\r\n');

  // Client disconnects
  wc.destroy();
  handlers.reapSessions(112);

  // New renderer wc2 connects
  const wc2 = new MockWebContents(212);
  const panel = {
    id: 'sess-pre-attach-live',
    lastSeenSeq: 0,
    isAttaching: false,
    attachPendingBuffer: [],
    dataQueue: Promise.resolve(),
    received: [],
  };

  async function processEvent(p, { seq, data }) {
    if (typeof seq === 'number') {
      if (seq <= p.lastSeenSeq) return;
      p.lastSeenSeq = seq;
    }
    p.received.push({ seq, data });
  }

  // Live event handler simulating onTermData with attachPendingBuffer
  function onTermData(p, event) {
    if (p.isAttaching) {
      p.attachPendingBuffer.push(event);
      return;
    }
    p.dataQueue = p.dataQueue.then(() => processEvent(p, event)).catch(() => {});
  }

  // Hook live term:data stream
  wc2.send = (channel, payload) => {
    if (channel === 'term:data') {
      onTermData(panel, { seq: payload.seq, data: payload.data });
    }
  };

  // Subscribe wc2 to service events (simulating the client subscription during attach)
  service.subscribe('sess-pre-attach-live', (ev) => {
    if (ev.type === 'data') {
      wc2.send('term:data', { id: 'sess-pre-attach-live', data: ev.data, seq: ev.seq });
    }
  });

  // Mark attach active BEFORE invoking attach
  panel.isAttaching = true;
  panel.attachPendingBuffer = [];

  // PTY emits chunk 3 LIVE *BEFORE* termAttach resolves
  proc.emit('data', 'chunk 3\r\n');

  // Verify chunk 3 was caught in attachPendingBuffer and NOT yet processed into received
  assert.equal(panel.attachPendingBuffer.length, 1);
  assert.equal(panel.attachPendingBuffer[0].seq, 3);
  assert.equal(panel.received.length, 0);

  // Now termAttach resolves
  const attached = await handlers['term:attach'](wc2, { id: panel.id, fromSeq: 1 });
  assert.equal(attached.ok, true);

  // Replay enqueued first, then attachPendingBuffer drained in sequence order
  panel.dataQueue = panel.dataQueue.then(() => {
    // 1. Apply replay chunks
    for (const c of attached.chunks) {
      if (c.seq > panel.lastSeenSeq) {
        panel.received.push({ seq: c.seq, data: c.data });
        panel.lastSeenSeq = c.seq;
      }
    }
    // 2. Drain pending live buffer in sequence order
    const pending = panel.attachPendingBuffer;
    panel.attachPendingBuffer = [];
    pending.sort((a, b) => a.seq - b.seq);
    for (const ev of pending) {
      if (ev.seq > panel.lastSeenSeq) {
        panel.received.push({ seq: ev.seq, data: ev.data });
        panel.lastSeenSeq = ev.seq;
      }
    }
    panel.isAttaching = false;
  });

  // Another live chunk (seq 4) arrives afterwards
  proc.emit('data', 'chunk 4\r\n');

  await panel.dataQueue;

  // Verify all 4 chunks are received in exact sequence order: [1, 2, 3, 4]
  assert.equal(panel.received.length, 4);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2, 3, 4]);
  assert.deepEqual(panel.received.map(c => c.data), [
    'chunk 1\r\n',
    'chunk 2\r\n',
    'chunk 3\r\n',
    'chunk 4\r\n',
  ]);
});

test('regression 1: termAttach includes fromSeq=lastSeenSeq+1 to avoid duplicate replay chunks', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc1 = new MockWebContents(301);

  await handlers['term:create'](wc1, { id: 'sess-replay-cursor', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Emit 3 chunks: seq 1, 2, 3
  proc.emit('data', 'one\r\n');
  proc.emit('data', 'two\r\n');
  proc.emit('data', 'three\r\n');

  const wc2 = new MockWebContents(302);
  // Suppose renderer already saw chunks 1 and 2 (lastSeenSeq = 2)
  const lastSeenSeq = 2;
  const attached = await handlers['term:attach'](wc2, {
    id: 'sess-replay-cursor',
    fromSeq: lastSeenSeq + 1,
  });

  assert.equal(attached.ok, true);
  // Verify attach only returned chunk 3, not chunks 1 or 2
  assert.equal(attached.chunks.length, 1);
  assert.equal(attached.chunks[0].seq, 3);
  assert.equal(attached.chunks[0].data, 'three\r\n');
});

test('regression 2: attach failure while live output arrives reconciles buffer and does not spawn duplicate PTY', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc1 = new MockWebContents(303);

  // Existing active session
  await handlers['term:create'](wc1, { id: 'sess-existing-pty', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  const panel = {
    id: 'sess-existing-pty',
    kind: 'shell',
    started: false,
    lastSeenSeq: 0,
    isAttaching: false,
    attachPendingBuffer: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const wc2 = new MockWebContents(304);

  // Subscribe wc2 to live events from service
  service.subscribe(panel.id, (ev) => {
    if (ev.type === 'data') {
      if (panel.isAttaching) {
        panel.attachPendingBuffer.push({ id: panel.id, data: ev.data, seq: ev.seq });
      }
    }
  });

  // Track spawn count to ensure no duplicate PTY is spawned
  let spawnCount = 0;
  const origSpawn = service._pty.spawn;
  service._pty.spawn = (...args) => {
    spawnCount++;
    return origSpawn(...args);
  };

  // Simulate attach handler encountering a transient IPC error / throwing
  let attachInvoked = false;
  async function simulateAttachWithLiveArrival() {
    panel.started = true;
    panel.isAttaching = true;
    panel.attachPendingBuffer = [];

    // Live output arrives while attach is in-flight
    proc.emit('data', 'live chunk arrived during attach\r\n');

    let attachResult = null;
    let attachThrew = false;
    try {
      // Simulate transient error / throw
      throw new Error('transient IPC disconnection');
    } catch (_) {
      attachThrew = true;
    }

    const bufferedEvents = panel.attachPendingBuffer || [];
    panel.attachPendingBuffer = [];
    panel.isAttaching = false;

    // Reconciliation logic from renderer:
    if (bufferedEvents.length > 0) {
      // Live events arrived: session is alive, do NOT spawn a duplicate PTY!
      panel.dataQueue = panel.dataQueue.then(() => {
        for (const ev of bufferedEvents) {
          panel.received.push({ seq: ev.seq, data: ev.data });
          panel.lastSeenSeq = ev.seq;
        }
      });
      await panel.dataQueue;
      return { attached: false, reconciled: true };
    }

    if (attachThrew || (attachResult && attachResult.error !== 'session not found')) {
      panel.started = false;
      return { attached: false, error: 'ipc error' };
    }

    // Only falls back to create if session not found
    await handlers['term:create'](wc2, { id: panel.id, kind: panel.kind });
    return { attached: false, created: true };
  }

  const result = await simulateAttachWithLiveArrival();
  assert.equal(result.reconciled, true);
  // Verify NO duplicate spawn was initiated!
  assert.equal(spawnCount, 0);
  // Verify buffered chunk was retained and applied
  assert.equal(panel.received.length, 1);
  assert.equal(panel.received[0].data, 'live chunk arrived during attach\r\n');
  assert.equal(panel.lastSeenSeq, 1);
});

test('regression 3: replay failure followed by no further live events performs independent retry recovery', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(305);

  await handlers['term:create'](wc, { id: 'sess-gap-retry', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  // Let session buffer have seq 1 and 2
  proc.emit('data', 'chunk 1\r\n');
  proc.emit('data', 'chunk 2\r\n');

  const panel = {
    id: 'sess-gap-retry',
    lastSeenSeq: 0,
    pendingGapEvents: [],
    pendingGapRetries: 0,
    received: [],
    dataQueue: Promise.resolve(),
  };

  let replayAttempts = 0;
  let simulateReplayFailure = true;

  async function mockTermReplay({ id, fromSeq }) {
    replayAttempts++;
    if (simulateReplayFailure) {
      throw new Error('transient replay error');
    }
    return handlers['term:replay'](wc, { id, fromSeq });
  }

  function applyChunks(p, chunks) {
    for (const c of chunks) {
      if (c && c.data && typeof c.seq === 'number' && c.seq > p.lastSeenSeq) {
        p.lastSeenSeq = c.seq;
        p.received.push({ seq: c.seq, data: c.data });
      }
    }
  }

  async function retryGap(p) {
    p.pendingGapRetries = (p.pendingGapRetries || 0) + 1;
    const expected = (p.lastSeenSeq || 0) + 1;
    try {
      const replay = await mockTermReplay({ id: p.id, fromSeq: expected });
      if (replay && Array.isArray(replay.chunks)) {
        applyChunks(p, replay.chunks);
      }
    } catch (_) {}

    // Drain pending events now covered
    p.pendingGapEvents = p.pendingGapEvents.filter(e => e.seq > p.lastSeenSeq);
    p.pendingGapEvents.sort((a, b) => a.seq - b.seq);
    while (p.pendingGapEvents.length && p.pendingGapEvents[0].seq === p.lastSeenSeq + 1) {
      const next = p.pendingGapEvents.shift();
      p.lastSeenSeq = next.seq;
      p.received.push({ seq: next.seq, data: next.data });
    }
  }

  // Suppose chunk 2 arrives with gap (panel has lastSeenSeq = 0, expecting 1)
  // Replay fails initially:
  try {
    await mockTermReplay({ id: panel.id, fromSeq: 1 });
  } catch (_) {
    // Gap unresolved, retain chunk 2 in pendingGapEvents
    panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 2\r\n', seq: 2 });
  }

  assert.equal(panel.received.length, 0);
  assert.equal(panel.pendingGapEvents.length, 1);
  assert.equal(panel.lastSeenSeq, 0);

  // NO further live events arrive. Independent retry triggers after network restores:
  simulateReplayFailure = false;
  await retryGap(panel);

  // Verify retry recovered chunk 1, then drained chunk 2 in strict order
  assert.equal(panel.received.length, 2);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2]);
  assert.deepEqual(panel.received.map(c => c.data), ['chunk 1\r\n', 'chunk 2\r\n']);
  assert.equal(panel.pendingGapEvents.length, 0);
  assert.equal(panel.lastSeenSeq, 2);
});

test('regression 4: applyReplayChunks validates contiguous sequences and stops on gaps without skipping output', () => {
  const panel = {
    id: 'test-gap-replay',
    lastSeenSeq: 10,
    written: [],
  };

  const tile = {
    term: {
      write: (data) => panel.written.push(data),
    },
  };

  function applyReplayChunks(p, chunks) {
    if (!chunks || !Array.isArray(chunks) || !chunks.length) return false;
    const sorted = [...chunks].filter(c => c && typeof c.seq === 'number').sort((a, b) => a.seq - b.seq);
    let current = p.lastSeenSeq || 0;
    let anyApplied = false;

    for (const c of sorted) {
      if (c.seq <= current) continue;
      if (c.seq === current + 1) {
        current = c.seq;
        p.lastSeenSeq = current;
        tile.term.write(c.data);
        anyApplied = true;
      } else {
        // Gap encountered (e.g. 11, then 13 with 12 missing) -> stop contiguous advancement!
        break;
      }
    }
    return anyApplied;
  }

  // Suppose replay returned seq 11, 13, 14 (12 missing)
  const chunks = [
    { seq: 11, data: 'chunk 11\r\n' },
    { seq: 13, data: 'chunk 13\r\n' },
    { seq: 14, data: 'chunk 14\r\n' },
  ];

  const applied = applyReplayChunks(panel, chunks);
  assert.equal(applied, true);
  // Verify seq 11 was applied, but lastSeenSeq stopped at 11 and did NOT advance to 13/14
  assert.equal(panel.lastSeenSeq, 11);
  assert.deepEqual(panel.written, ['chunk 11\r\n']);
});

test('regression 5: fresh PTY emitting output before termCreate resolves is processed against clean seq state without race', async () => {
  const { service, handlers } = createIpcHarness();
  const wc = new MockWebContents(306);

  // Panel state restored from saved workspace with high lastSeenSeq
  const panel = {
    id: 'sess-early-output-pty',
    kind: 'shell',
    started: false,
    lastSeenSeq: 999, // Stale state from previous desk session
    queuedData: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  // Wire mock renderer onTermData
  function onTermData(p, ev) {
    p.dataQueue = p.dataQueue.then(() => {
      // Monotonic sequence processing
      if (typeof ev.seq === 'number') {
        if (ev.seq <= p.lastSeenSeq) return;
        p.lastSeenSeq = ev.seq;
      }
      p.received.push({ seq: ev.seq, data: ev.data });
    });
  }

  wc.send = (channel, payload) => {
    if (channel === 'term:data') {
      onTermData(panel, payload);
    }
  };

  // Hook mock pty module spawn on service to emit early output immediately before create() resolves
  const origModule = new MockPtyModule();
  origModule.spawn = (...args) => {
    const proc = new MockPtyProcess({ pid: 8888 });
    // When PtyExecutionService attaches proc.onData, emit early output
    const origOnData = proc.onData.bind(proc);
    proc.onData = (cb) => {
      origOnData(cb);
      setTimeout(() => {
        proc.emit('data', 'early banner 1\r\n');
        proc.emit('data', 'early banner 2\r\n');
      }, 5);
    };
    return proc;
  };
  service._pty = origModule;

  async function simulateStartProcess(p) {
    if (p.started) return;
    p.started = true;

    // Reset sequence state BEFORE initiating termCreate!
    p.lastSeenSeq = 0;
    p.queuedData = [];
    p.pendingGapEvents = [];

    const made = await handlers['term:create'](wc, { id: p.id, kind: p.kind });
    assert.equal(made.ok, true);
  }

  await simulateStartProcess(panel);
  await new Promise(r => setTimeout(r, 20));
  await panel.dataQueue;

  // Verify early output was received cleanly, not rejected as duplicate against stale lastSeenSeq=999
  assert.equal(panel.received.length, 2);
  assert.deepEqual(panel.received.map(c => c.seq), [1, 2]);
  assert.deepEqual(panel.received.map(c => c.data), ['early banner 1\r\n', 'early banner 2\r\n']);
  assert.equal(panel.lastSeenSeq, 2);
});

test('regression 6: PtyExecutionService replay returns earliestSeq and nextSeq metadata', async () => {
  const { service, ptyModule, handlers } = createIpcHarness();
  const wc = new MockWebContents(307);

  await handlers['term:create'](wc, { id: 'sess-earliest-seq', kind: 'shell' });
  const proc = ptyModule.activeProcess;

  proc.emit('data', 'output A\r\n');
  proc.emit('data', 'output B\r\n');

  const replay = service.replay('sess-earliest-seq', 1);
  assert.equal(typeof replay.earliestSeq, 'number');
  assert.equal(typeof replay.nextSeq, 'number');
  assert.equal(replay.earliestSeq, 1);
  assert.equal(replay.nextSeq, 3);
  assert.equal(replay.chunks.length, 2);

  // Also verify term:replay IPC handler forwards earliestSeq
  const ipcReplay = await handlers['term:replay'](wc, { id: 'sess-earliest-seq', fromSeq: 1 });
  assert.equal(typeof ipcReplay.earliestSeq, 'number');
  assert.equal(ipcReplay.earliestSeq, 1);
});

test('regression 7: attach replay ending at 11 with buffered events 12 and 14 prevents 14 from overtaking missing 13', async () => {
  const panel = {
    id: 'sess-buffered-gap',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  function applyReplayChunks(p, chunks) {
    if (!chunks || !Array.isArray(chunks) || !chunks.length) return false;
    const sorted = [...chunks].filter(c => c && typeof c.seq === 'number').sort((a, b) => a.seq - b.seq);
    let current = p.lastSeenSeq || 0;
    for (const c of sorted) {
      if (c.seq <= current) continue;
      if (c.seq === current + 1) {
        current = c.seq;
        p.lastSeenSeq = current;
        mockTile.term.write(c.data);
      } else {
        break;
      }
    }
  }

  async function processEvent(p, id, data, seq) {
    if (typeof seq === 'number') {
      if (seq <= (p.lastSeenSeq || 0)) return;
      const expected = (p.lastSeenSeq || 0) + 1;
      if (seq > expected) {
        // Gap: buffer into pendingGapEvents and do NOT advance lastSeenSeq
        p.pendingGapEvents.push({ id, data, seq });
        return;
      }
      p.lastSeenSeq = seq;
    }
    mockTile.term.write(data);
  }

  // Simulate attach response returning chunk 11
  const attachResult = {
    ok: true,
    chunks: [{ seq: 11, data: 'chunk 11\r\n' }],
  };

  // During attachment, events 12 and 14 arrive (13 is missing in the live stream)
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 12\r\n', seq: 12 });
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 14\r\n', seq: 14 });

  // Attach success path:
  panel.dataQueue = panel.dataQueue.then(async () => {
    applyReplayChunks(panel, attachResult.chunks);

    // Drain attachPendingBuffer via sequence-aware processor
    const pending = panel.attachPendingBuffer;
    panel.attachPendingBuffer = [];
    pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
    for (const ev of pending) {
      await processEvent(panel, ev.id, ev.data, ev.seq);
    }
    panel.isAttaching = false;
  });

  await panel.dataQueue;

  // Verify chunk 11 was applied by replay
  // Verify chunk 12 was accepted
  // Verify chunk 14 was NOT written and did NOT advance lastSeenSeq past missing chunk 13!
  assert.equal(panel.lastSeenSeq, 12);
  assert.deepEqual(writtenToTerm, ['chunk 11\r\n', 'chunk 12\r\n']);
  assert.equal(panel.pendingGapEvents.length, 1);
  assert.equal(panel.pendingGapEvents[0].seq, 14);
});

test('regression 8: restored cursor 500 attaching when earliestSeq is 800 reports truncation and recovers available output', async () => {
  const panel = {
    id: 'sess-rotated-attach',
    lastSeenSeq: 500, // Restored cursor from an older saved session
    isAttaching: true,
    attachPendingBuffer: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  function applyReplayChunks(p, chunks) {
    if (!chunks || !Array.isArray(chunks) || !chunks.length) return false;
    const sorted = [...chunks].filter(c => c && typeof c.seq === 'number').sort((a, b) => a.seq - b.seq);
    let current = p.lastSeenSeq || 0;
    for (const c of sorted) {
      if (c.seq <= current) continue;
      if (c.seq === current + 1) {
        current = c.seq;
        p.lastSeenSeq = current;
        mockTile.term.write(c.data);
      } else {
        break;
      }
    }
  }

  // Simulate attach result from service whose ring buffer rotated: earliestSeq is 800
  const attachResult = {
    ok: true,
    earliestSeq: 800,
    nextSeq: 803,
    chunks: [
      { seq: 800, data: 'chunk 800\r\n' },
      { seq: 801, data: 'chunk 801\r\n' },
      { seq: 802, data: 'chunk 802\r\n' },
    ],
  };

  // Attach success path with buffer rotation check:
  panel.dataQueue = panel.dataQueue.then(async () => {
    const expected = (panel.lastSeenSeq || 0) + 1; // 501
    if (typeof attachResult.earliestSeq === 'number' && attachResult.earliestSeq > expected) {
      mockTile.term.write(`\r\n\x1b[33m[terminal: output truncated due to buffer rotation (${expected}..${attachResult.earliestSeq - 1})]\x1b[0m\r\n`);
      panel.lastSeenSeq = attachResult.earliestSeq - 1; // 799
    }

    if (Array.isArray(attachResult.chunks)) {
      applyReplayChunks(panel, attachResult.chunks);
    }
    panel.isAttaching = false;
  });

  await panel.dataQueue;

  // Verify truncation notice was rendered
  assert.equal(writtenToTerm[0].includes('output truncated due to buffer rotation (501..799)'), true);
  // Verify chunks 800, 801, 802 were cleanly applied
  assert.equal(writtenToTerm[1], 'chunk 800\r\n');
  assert.equal(writtenToTerm[2], 'chunk 801\r\n');
  assert.equal(writtenToTerm[3], 'chunk 802\r\n');
  // Verify sequence successfully advanced to 802
  assert.equal(panel.lastSeenSeq, 802);
});

test('regression 9: live event arriving while processTermDataEvent is awaiting gap replay is caught by drain loop', async () => {
  const panel = {
    id: 'sess-attach-drain-loop',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  function applyReplayChunks(p, chunks) {
    if (!chunks || !Array.isArray(chunks) || !chunks.length) return false;
    const sorted = [...chunks].filter(c => c && typeof c.seq === 'number').sort((a, b) => a.seq - b.seq);
    let current = p.lastSeenSeq || 0;
    for (const c of sorted) {
      if (c.seq <= current) continue;
      if (c.seq === current + 1) {
        current = c.seq;
        p.lastSeenSeq = current;
        mockTile.term.write(c.data);
      } else {
        break;
      }
    }
  }

  // Simulated termReplay that recovers missing sequence 12
  async function mockTermReplay({ id, fromSeq }) {
    // While this replay is awaiting / processing, another live event (seq 14) arrives!
    if (panel.isAttaching) {
      panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 14\r\n', seq: 14 });
    }
    return {
      chunks: [{ seq: 12, data: 'chunk 12 (replayed)\r\n' }],
    };
  }

  async function processTermDataEvent(p, id, data, seq) {
    if (typeof seq === 'number') {
      if (seq <= (p.lastSeenSeq || 0)) return;
      const expected = (p.lastSeenSeq || 0) + 1;
      if (seq > expected) {
        // Gap detected: await replay
        const replay = await mockTermReplay({ id: p.id, fromSeq: expected });
        if (replay && Array.isArray(replay.chunks)) {
          applyReplayChunks(p, replay.chunks);
        }
      }
      if (seq <= (p.lastSeenSeq || 0)) return;
      p.lastSeenSeq = seq;
    }
    mockTile.term.write(data);
  }

  // Initial attach response recovers chunk 11
  const attachResult = {
    ok: true,
    chunks: [{ seq: 11, data: 'chunk 11\r\n' }],
  };

  // Live event 13 arrived while attach was resolving (sequence gap: 12 was missed)
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 13\r\n', seq: 13 });

  // Attach success path with drain-until-empty loop
  panel.dataQueue = panel.dataQueue.then(async () => {
    applyReplayChunks(panel, attachResult.chunks);

    // Drain-until-empty loop
    while (panel.attachPendingBuffer && panel.attachPendingBuffer.length > 0) {
      const pending = panel.attachPendingBuffer;
      panel.attachPendingBuffer = [];
      pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      for (const ev of pending) {
        await processTermDataEvent(panel, ev.id, ev.data, ev.seq);
      }
    }

    panel.isAttaching = false;
  });

  await panel.dataQueue;

  // Verify that:
  // 1. Replay 11 was written first
  // 2. Event 13 triggered recovery of missing 12, so 12 was written next
  // 3. Event 13 was written
  // 4. Event 14 (arrived while awaiting replay 12) was caught in the second loop pass and written
  // 5. Sequence ended at 14 with all chunks in exact strict order
  assert.equal(panel.isAttaching, false);
  assert.equal(panel.lastSeenSeq, 14);
  assert.deepEqual(writtenToTerm, [
    'chunk 11\r\n',
    'chunk 12 (replayed)\r\n',
    'chunk 13\r\n',
    'chunk 14\r\n',
  ]);
});

test('regression 10: processTermDataEvent error during drain batch retains events and blocks silent live transition', async () => {
  const panel = {
    id: 'sess-drain-error-test',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  let failOnSeq12 = true;
  async function processTermDataEvent(p, id, data, seq) {
    if (seq === 12 && failOnSeq12) {
      throw new Error('simulated disk/terminal write failure on seq 12');
    }
    p.lastSeenSeq = seq;
    mockTile.term.write(data);
  }

  // Populate attachPendingBuffer with events 11, 12, 13
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 11\r\n', seq: 11 });
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 12\r\n', seq: 12 });
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 13\r\n', seq: 13 });

  let drainErrorCaught = null;
  panel.dataQueue = panel.dataQueue.then(async () => {
    while (panel.attachPendingBuffer && panel.attachPendingBuffer.length > 0) {
      const pending = panel.attachPendingBuffer;
      panel.attachPendingBuffer = [];
      pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      for (let i = 0; i < pending.length; i++) {
        const ev = pending[i];
        try {
          await processTermDataEvent(panel, ev.id, ev.data, ev.seq);
        } catch (err) {
          // Retain un-drained events in pendingGapEvents
          panel.pendingGapEvents = panel.pendingGapEvents || [];
          for (let j = i; j < pending.length; j++) {
            if (!panel.pendingGapEvents.some(e => e.seq === pending[j].seq)) {
              panel.pendingGapEvents.push(pending[j]);
            }
          }
          mockTile.term.write(`\r\n[terminal: error processing attach replay: ${err.message}]\r\n`);
          throw err;
        }
      }
    }
    panel.isAttaching = false;
  }).catch((err) => {
    drainErrorCaught = err;
    // Crucial: do NOT clear isAttaching when pending events remain unresolved!
    if (panel.isAttaching && (!panel.attachPendingBuffer || !panel.attachPendingBuffer.length) && (!panel.pendingGapEvents || !panel.pendingGapEvents.length)) {
      panel.isAttaching = false;
    }
  });

  await panel.dataQueue;

  // 1. Verify error was raised and surfaced
  assert.ok(drainErrorCaught);
  assert.equal(drainErrorCaught.message.includes('simulated disk/terminal write failure on seq 12'), true);

  // 2. Verify isAttaching was NOT cleared (panel cannot silently enter normal live processing)
  assert.equal(panel.isAttaching, true);

  // 3. Verify event 11 was applied, and events 12 and 13 were RETAINED in pendingGapEvents (not lost)
  assert.equal(panel.lastSeenSeq, 11);
  assert.deepEqual(writtenToTerm[0], 'chunk 11\r\n');
  assert.equal(panel.pendingGapEvents.length, 2);
  assert.deepEqual(panel.pendingGapEvents.map(e => e.seq), [12, 13]);

  // 4. Now simulate recovery: retry drains the retained pendingGapEvents
  failOnSeq12 = false;
  panel.dataQueue = panel.dataQueue.then(async () => {
    while (panel.pendingGapEvents.length > 0) {
      const next = panel.pendingGapEvents.shift();
      await processTermDataEvent(panel, next.id, next.data, next.seq);
    }
    panel.isAttaching = false;
  });

  await panel.dataQueue;

  // 5. Verify full reconciliation succeeded and isAttaching is safely false
  assert.equal(panel.isAttaching, false);
  assert.equal(panel.lastSeenSeq, 13);
  assert.equal(panel.pendingGapEvents.length, 0);
  assert.deepEqual(writtenToTerm.filter(d => !d.startsWith('\r\n[terminal:')), [
    'chunk 11\r\n',
    'chunk 12\r\n',
    'chunk 13\r\n',
  ]);
});

test('regression 11: attach drain fails, retry recovery succeeds, and panel safely releases attach gate and resumes live events', async () => {
  const panel = {
    id: 'sess-drain-retry-success',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  async function processTermDataEvent(p, id, data, seq) {
    p.lastSeenSeq = seq;
    mockTile.term.write(data);
  }

  // Live onTermData listener
  function onTermData(p, ev) {
    if (p.isAttaching) {
      p.attachPendingBuffer.push(ev);
      return;
    }
    p.dataQueue = p.dataQueue.then(() => processTermDataEvent(p, ev.id, ev.data, ev.seq));
  }

  // 1. Initial attach drain fails on seq 11, leaving seq 11 in pendingGapEvents and isAttaching = true
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 11\r\n', seq: 11 });

  // 2. While held in isAttaching waiting for retry recovery, a live event (seq 12) arrives and is buffered
  onTermData(panel, { id: panel.id, data: 'chunk 12\r\n', seq: 12 });
  assert.equal(panel.attachPendingBuffer.length, 1);
  assert.equal(panel.isAttaching, true);

  // 3. Retry recovery runs: drains pendingGapEvents, then drains attachPendingBuffer, then releases attach gate
  panel.dataQueue = panel.dataQueue.then(async () => {
    // Drain pendingGapEvents
    while (panel.pendingGapEvents.length > 0) {
      const next = panel.pendingGapEvents.shift();
      await processTermDataEvent(panel, next.id, next.data, next.seq);
    }
    // Transition: drain attachPendingBuffer before releasing gate
    if (panel.isAttaching && (!panel.pendingGapEvents || !panel.pendingGapEvents.length)) {
      while (panel.attachPendingBuffer && panel.attachPendingBuffer.length > 0) {
        const pending = panel.attachPendingBuffer;
        panel.attachPendingBuffer = [];
        pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        for (const ev of pending) {
          await processTermDataEvent(panel, ev.id, ev.data, ev.seq);
        }
      }
      panel.isAttaching = false;
    }
  });

  await panel.dataQueue;

  // Verify attach gate is released and buffered event was processed
  assert.equal(panel.isAttaching, false);
  assert.equal(panel.lastSeenSeq, 12);
  assert.deepEqual(writtenToTerm, ['chunk 11\r\n', 'chunk 12\r\n']);

  // 4. Now send another live event (seq 13) - verify it passes straight through dataQueue without buffering!
  onTermData(panel, { id: panel.id, data: 'chunk 13\r\n', seq: 13 });
  await panel.dataQueue;

  assert.equal(panel.attachPendingBuffer.length, 0);
  assert.equal(panel.lastSeenSeq, 13);
  assert.deepEqual(writtenToTerm, ['chunk 11\r\n', 'chunk 12\r\n', 'chunk 13\r\n']);
});

test('regression 12: retry exhaustion resynchronizes, reports output lost, and does not leave panel permanently gated', async () => {
  const panel = {
    id: 'sess-retry-exhaustion-test',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    pendingGapRetries: 10, // Max retries exhausted
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  async function processTermDataEvent(p, id, data, seq) {
    p.lastSeenSeq = seq;
    mockTile.term.write(data);
  }

  // Gap between 10 and 20: sequence 11..19 were lost
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 20\r\n', seq: 20 });
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 21\r\n', seq: 21 });

  // Simulate retry recovery hitting maxRetries
  panel.dataQueue = panel.dataQueue.then(async () => {
    const maxRetries = 10;
    if (panel.pendingGapRetries >= maxRetries) {
      panel.pendingGapEvents.sort((a, b) => a.seq - b.seq);
      const nextPending = panel.pendingGapEvents[0];
      mockTile.term.write(`\r\n[terminal: unrecoverable gap between ${panel.lastSeenSeq || 0} and ${nextPending.seq}; output lost and desync resynchronized]\r\n`);
      panel.lastSeenSeq = nextPending.seq - 1; // 19
      while (panel.pendingGapEvents.length && panel.pendingGapEvents[0].seq === (panel.lastSeenSeq || 0) + 1) {
        const next = panel.pendingGapEvents.shift();
        panel.lastSeenSeq = next.seq;
        mockTile.term.write(next.data);
      }
      panel.pendingGapRetries = 0;
    }

    // Attach gate transition logic:
    if (panel.isAttaching && (!panel.pendingGapEvents || !panel.pendingGapEvents.length)) {
      while (panel.attachPendingBuffer && panel.attachPendingBuffer.length > 0) {
        const pending = panel.attachPendingBuffer;
        panel.attachPendingBuffer = [];
        pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        for (const ev of pending) {
          await processTermDataEvent(panel, ev.id, ev.data, ev.seq);
        }
      }
      panel.isAttaching = false;
    }
  });

  await panel.dataQueue;

  // Verify desync notice reports output was lost
  assert.equal(writtenToTerm[0].includes('output lost and desync resynchronized'), true);
  // Verify chunk 20 and chunk 21 were processed in order
  assert.equal(writtenToTerm[1], 'chunk 20\r\n');
  assert.equal(writtenToTerm[2], 'chunk 21\r\n');
  // Verify attach gate is safely released (panel not permanently stuck)
  assert.equal(panel.isAttaching, false);
  assert.equal(panel.lastSeenSeq, 21);
});

test('regression 13: new sequence gap appearing while retry recovery drains attachPendingBuffer keeps attach gate closed', async () => {
  const panel = {
    id: 'sess-new-gap-in-drain',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    received: [],
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  async function processTermDataEvent(p, id, data, seq) {
    if (seq > p.lastSeenSeq + 1) {
      // New sequence gap encountered! Push to pendingGapEvents and do not advance
      p.pendingGapEvents.push({ id, data, seq });
      return;
    }
    p.lastSeenSeq = seq;
    mockTile.term.write(data);
  }

  // Initial state: recovery is clearing initial gap event 11
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 11\r\n', seq: 11 });

  // While waiting, attachPendingBuffer gets event 12 and event 14 (missing event 13!)
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 12\r\n', seq: 12 });
  panel.attachPendingBuffer.push({ id: panel.id, data: 'chunk 14\r\n', seq: 14 });

  let retryScheduled = false;
  function scheduleGapRetry() {
    retryScheduled = true;
  }

  // Run the recovery transition:
  panel.dataQueue = panel.dataQueue.then(async () => {
    // 1. Drain pendingGapEvents (chunk 11)
    while (panel.pendingGapEvents.length > 0) {
      const next = panel.pendingGapEvents.shift();
      await processTermDataEvent(panel, next.id, next.data, next.seq);
    }

    // 2. Attach gate release transition:
    if (panel.isAttaching && (!panel.pendingGapEvents || !panel.pendingGapEvents.length)) {
      while (panel.attachPendingBuffer && panel.attachPendingBuffer.length > 0) {
        const pending = panel.attachPendingBuffer;
        panel.attachPendingBuffer = [];
        pending.sort((a, b) => (a.seq || 0) - (b.seq || 0));
        for (let i = 0; i < pending.length; i++) {
          const ev = pending[i];
          await processTermDataEvent(panel, ev.id, ev.data, ev.seq);
          if (panel.pendingGapEvents && panel.pendingGapEvents.length > 0) {
            for (let j = i + 1; j < pending.length; j++) {
              panel.pendingGapEvents.push(pending[j]);
            }
            scheduleGapRetry();
            return;
          }
        }
      }
      if ((!panel.pendingGapEvents || !panel.pendingGapEvents.length) && (!panel.attachPendingBuffer || !panel.attachPendingBuffer.length)) {
        panel.isAttaching = false;
      }
    }
  });

  await panel.dataQueue;

  // Verify that:
  // 1. Event 11 and event 12 were processed
  // 2. Event 14 triggered a new gap, so it was put into pendingGapEvents
  // 3. isAttaching REMAINS true (gate kept closed, live events cannot skip)
  // 4. Retry was scheduled
  assert.equal(panel.lastSeenSeq, 12);
  assert.deepEqual(writtenToTerm, ['chunk 11\r\n', 'chunk 12\r\n']);
  assert.equal(panel.pendingGapEvents.length, 1);
  assert.equal(panel.pendingGapEvents[0].seq, 14);
  assert.equal(panel.isAttaching, true);
  assert.equal(retryScheduled, true);
});

test('regression 14: retry exhaustion leaving a second disconnected pending group schedules subsequent retry', async () => {
  const panel = {
    id: 'sess-second-group-exhaustion',
    lastSeenSeq: 10,
    isAttaching: true,
    attachPendingBuffer: [],
    pendingGapEvents: [],
    pendingGapRetries: 10,
    dataQueue: Promise.resolve(),
  };

  const writtenToTerm = [];
  const mockTile = {
    term: {
      write: (data) => writtenToTerm.push(data),
    },
  };

  let retryScheduled = false;
  function scheduleGapRetry() {
    retryScheduled = true;
  }

  // Suppose pendingGapEvents has two disconnected groups:
  // Group 1: 20, 21 (after gap from 10)
  // Group 2: 30 (after gap from 21)
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 20\r\n', seq: 20 });
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 21\r\n', seq: 21 });
  panel.pendingGapEvents.push({ id: panel.id, data: 'chunk 30\r\n', seq: 30 });

  panel.dataQueue = panel.dataQueue.then(async () => {
    const maxRetries = 10;
    if (panel.pendingGapRetries >= maxRetries) {
      panel.pendingGapEvents.sort((a, b) => a.seq - b.seq);
      const nextPending = panel.pendingGapEvents[0];
      mockTile.term.write(`\r\n[terminal: unrecoverable gap between ${panel.lastSeenSeq || 0} and ${nextPending.seq}; output lost and desync resynchronized]\r\n`);
      panel.lastSeenSeq = nextPending.seq - 1; // 19
      while (panel.pendingGapEvents.length && panel.pendingGapEvents[0].seq === (panel.lastSeenSeq || 0) + 1) {
        const next = panel.pendingGapEvents.shift();
        panel.lastSeenSeq = next.seq;
        mockTile.term.write(next.data);
      }
      if (panel.pendingGapEvents.length > 0) {
        panel.pendingGapRetries = 0;
        scheduleGapRetry();
        return;
      }
      panel.pendingGapRetries = 0;
    }
  });

  await panel.dataQueue;

  // Verify group 1 (20, 21) was resynchronized and drained
  assert.equal(panel.lastSeenSeq, 21);
  assert.equal(writtenToTerm[1], 'chunk 20\r\n');
  assert.equal(writtenToTerm[2], 'chunk 21\r\n');

  // Verify group 2 (30) is NOT stranded: remains in pendingGapEvents and scheduled for retry
  assert.equal(panel.pendingGapEvents.length, 1);
  assert.equal(panel.pendingGapEvents[0].seq, 30);
  assert.equal(retryScheduled, true);
  assert.equal(panel.isAttaching, true);
});
