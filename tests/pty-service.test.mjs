import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PtyExecutionService, CircularOutputBuffer } from '../src/main/pty-service.js';

class MockPty {
  constructor(file, args, opts) {
    this.file = file;
    this.args = args;
    this.opts = opts;
    this.pid = 12345;
    this.written = [];
    this.resized = null;
    this.killed = false;
    this._dataListeners = [];
    this._exitListeners = [];
  }

  onData(cb) {
    this._dataListeners.push(cb);
  }

  onExit(cb) {
    this._exitListeners.push(cb);
  }

  write(data) {
    this.written.push(data);
  }

  resize(cols, rows) {
    this.resized = { cols, rows };
  }

  kill(signal) {
    this.killed = true;
    for (const cb of this._exitListeners) {
      cb({ exitCode: 0, signal: signal || 1 });
    }
  }

  emitData(chunk) {
    for (const cb of this._dataListeners) {
      cb(chunk);
    }
  }

  emitExit(exitCode, signal) {
    for (const cb of this._exitListeners) {
      cb({ exitCode, signal });
    }
  }
}

test('CircularOutputBuffer appends chunks and assigns monotonic seq numbers', () => {
  const buf = new CircularOutputBuffer({ maxBytes: 1000 });
  const c1 = buf.append('hello ');
  const c2 = buf.append('world\n');

  assert.equal(c1.seq, 1);
  assert.equal(c2.seq, 2);

  const replayed = buf.replay(1);
  assert.equal(replayed.chunks.length, 2);
  assert.equal(replayed.chunks[0].data, 'hello ');
  assert.equal(replayed.chunks[1].data, 'world\n');

  const partial = buf.replay(2);
  assert.equal(partial.chunks.length, 1);
  assert.equal(partial.chunks[0].seq, 2);
});

test('CircularOutputBuffer evicts oldest chunks when exceeding maxBytes', () => {
  const buf = new CircularOutputBuffer({ maxBytes: 15 });
  buf.append('12345'); // 5 bytes (seq 1)
  buf.append('67890'); // 5 bytes (seq 2)
  buf.append('abcde'); // 5 bytes (seq 3)
  buf.append('fghij'); // 5 bytes (seq 4) -> total 20 > 15, should drop seq 1

  const replayed = buf.replay(0);
  assert.equal(replayed.earliestSeq, 2);
  assert.equal(replayed.chunks.length, 3);
  assert.equal(replayed.chunks[0].seq, 2);
  assert.equal(replayed.chunks[2].seq, 4);
});

test('PtyExecutionService reports error when node-pty is unavailable', async () => {
  const events = [];
  const service = new PtyExecutionService({ pty: null });
  service.on('event', (ev) => events.push(ev));

  const res = await service.create({ id: 'p1', kind: 'shell' });
  assert.equal(res.ok, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'data');
  assert.ok(events[0].data.includes('node-pty unavailable'));
});

test('PtyExecutionService handles spawn, write, resize, and normal exit', async () => {
  let createdPty = null;
  const mockPtyModule = {
    spawn: (file, args, opts) => {
      createdPty = new MockPty(file, args, opts);
      return createdPty;
    },
  };

  const events = [];
  const service = new PtyExecutionService({
    pty: mockPtyModule,
    readSettings: () => ({ theme: 'paper' }),
    env: { PATH: '/bin', SHELL: '/bin/bash' },
    platform: 'darwin',
  });
  service.on('event', (ev) => events.push(ev));

  const res = await service.create({ id: 'term-1', kind: 'shell', cols: 80, rows: 24 });
  assert.equal(res.ok, true);
  assert.equal(service.sessionCount, 1);
  assert.ok(createdPty);

  // Write
  const wrote = service.write('term-1', 'ls -la\r');
  assert.equal(wrote, true);
  assert.equal(createdPty.written[0], 'ls -la\r');

  // Resize
  const resized = service.resize('term-1', 100, 40);
  assert.equal(resized, true);
  assert.deepEqual(createdPty.resized, { cols: 100, rows: 40 });

  // Stream data
  createdPty.emitData('file1\r\nfile2\r\n');
  const dataEv = events.find((e) => e.type === 'data');
  assert.ok(dataEv);
  assert.equal(dataEv.data, 'file1\r\nfile2\r\n');
  assert.equal(dataEv.seq, 1);

  // Replay
  const replay = service.replay('term-1', 1);
  assert.equal(replay.chunks.length, 1);
  assert.equal(replay.chunks[0].data, 'file1\r\nfile2\r\n');

  // Exit
  createdPty.emitExit(0, 0);
  const exitEv = events.find((e) => e.type === 'exit');
  assert.ok(exitEv);
  assert.equal(exitEv.code, 0);
  assert.equal(exitEv.deliberate, false);
  assert.equal(service.sessionCount, 0);
});

test('PtyExecutionService kill marks deliberate and reaps session', async () => {
  let createdPty = null;
  const mockPtyModule = {
    spawn: (file, args, opts) => {
      createdPty = new MockPty(file, args, opts);
      return createdPty;
    },
  };

  const events = [];
  const service = new PtyExecutionService({
    pty: mockPtyModule,
    readSettings: () => ({}),
    platform: 'darwin',
  });
  service.on('event', (ev) => events.push(ev));

  await service.create({ id: 'term-kill', kind: 'shell' });
  assert.equal(service.sessionCount, 1);

  const killed = service.kill('term-kill');
  assert.equal(killed, true);
  assert.equal(createdPty.killed, true);
  assert.equal(service.sessionCount, 0);

  const exitEv = events.find((e) => e.type === 'exit');
  assert.ok(exitEv);
  assert.equal(exitEv.deliberate, true);
});

test('PtyExecutionService shutdown kills all live sessions without leaving orphans', async () => {
  const ptys = [];
  const mockPtyModule = {
    spawn: (file, args, opts) => {
      const p = new MockPty(file, args, opts);
      ptys.push(p);
      return p;
    },
  };

  const service = new PtyExecutionService({
    pty: mockPtyModule,
    readSettings: () => ({}),
    platform: 'darwin',
  });

  await service.create({ id: 'term-a', kind: 'shell' });
  await service.create({ id: 'term-b', kind: 'shell' });
  assert.equal(service.sessionCount, 2);

  service.shutdown();
  assert.equal(service.sessionCount, 0);
  assert.equal(ptys[0].killed, true);
  assert.equal(ptys[1].killed, true);
});

