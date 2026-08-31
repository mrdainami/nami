// Chat pane — assembles client + transcript + composer + command router into
// a live tile. This is the only file that knows about both the protocol side
// and the app side (attention, openFile, toast, renaming).

import { createAcpClient, normalizeUpdate } from './acp-client.mjs';
import { createTranscript } from './acp-render.mjs';
import { createComposer } from './acp-composer.mjs';
import { createCommandRouter } from './acp-commands.mjs';
import { chipHtml, iconKeyFor } from './icons.mjs';

const CLAUDE_ADAPTER = decodeURIComponent(new URL('../../acp-tools/node_modules/.bin/claude-agent-acp', location.href).pathname);
// One launch line per agent — probed on this machine (tools/acp-probe.mjs)
// before its row earns the Chat badge. Everything else about the pane is
// agent-agnostic: same renderer, same composer, same router.
const AGENT_LAUNCH = {
  claude: { command: CLAUDE_ADAPTER, args: [] },
  kimi: { command: 'kimi', args: ['acp'] },
  codex: { command: 'npx', args: ['-y', '@zed-industries/codex-acp'] },
  opencode: { command: 'opencode', args: ['acp'] },
  grok: { command: 'grok', args: ['agent', 'stdio'] },
  hermes: { command: 'hermes', args: ['acp'] },
};
export const CHAT_READY = Object.keys(AGENT_LAUNCH);

export function mountChatPane(p, rec, hooks) {
  const api = window.dainami;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = '<div class="cw-transcript"></div><div class="cw-composer-host"></div>';
  const scrollHost = body.querySelector('.cw-transcript');
  const compHost = body.querySelector('.cw-composer-host');

  const empty = document.createElement('div');
  empty.className = 'cw-empty';
  empty.innerHTML = '<div class="cw-empty-chip">' + chipHtml({ key: iconKeyFor(p.agentId || p.title || ''), code: p.code || 'AI', kind: 'agent' }) + '</div>'
    + '<div class="cw-empty-name"></div>'
    + '<div class="cw-empty-hint">Write a message to start — / shows commands</div>';
  empty.querySelector('.cw-empty-name').textContent = p.title || 'New session';
  scrollHost.appendChild(empty);
  new MutationObserver(() => {
    if (scrollHost.children.length > 1 && empty.parentElement) empty.remove();
  }).observe(scrollHost, { childList: true });

  const state = { commands: [], configOptions: [], modes: null, busy: false, connected: false };

  async function openSmart(path) {
    const tries = [path, path.normalize('NFD'), path.normalize('NFC'),
      path.replace(/ (AM|PM)\./, '\u202f$1.'), path.replace(/\u202f(AM|PM)\./, ' $1.')];
    for (const t of tries) {
      try {
        const st = await api.statPath({ token: t, cwd: p.cwd, id: p.id });
        if (st && st.exists) { hooks.open(st.path || t); return; }
      } catch (_) {}
    }
    hooks.open(path);
  }
  const transcript = createTranscript(scrollHost, {
    cwd: p.cwd,
    home: (p.cwd.match(/^\/(Users|home)\/[^/]+/) || [''])[0],
    onLink: (url) => { if (/^https?:/.test(url)) api.openLink(url); else hooks.open(url); },
    onCopy: (text) => { api.copyText(text); hooks.toast('Copied'); },
    onOpenFile: (path) => openSmart(path),
    onCommands: (list) => { state.commands = list; composer.setCommands(list); },
    onUsage: (used, size) => composer.setUsage(used, size),
    onInfo: (title) => { if (title && hooks.rename) hooks.rename(p, title); },
    onMode: (modeId) => { if (state.modes) { state.modes.currentModeId = modeId; syncChips(); } },
    onConfig: (configOptions) => mergeConfig(configOptions),
  });

  function currentCfg(id) { return state.configOptions.find((c) => c.id === id); }
  // A refresh may carry options-less entries; keep the fuller option lists we
  // already have so pickers never lose their rows.
  function mergeConfig(next) {
    if (!next) return;
    state.configOptions = next.map((co) => {
      const prev = state.configOptions.find((c) => c.id === co.id);
      return (!co.options || !co.options.length) && prev && prev.options && prev.options.length
        ? { ...co, options: prev.options } : co;
    });
    syncChips();
  }
  function syncChips() {
    if (state.modes && state.modes.availableModes) {
      const cur = state.modes.availableModes.find((m) => m.id === state.modes.currentModeId);
      composer.setMode(cur ? cur.name : null);
    }
    const model = currentCfg('model');
    if (model) {
      const cur = (model.options || []).find((o) => o.value === model.currentValue);
      composer.setModel(cur ? cur.name : String(model.currentValue || ''));
    }
  }

  async function cycleMode() {
    if (!state.modes || !state.modes.availableModes || !state.connected) return;
    const ms = state.modes.availableModes;
    const i = ms.findIndex((m) => m.id === state.modes.currentModeId);
    const next = ms[(i + 1) % ms.length];
    try {
      await client.setMode(next.id);
      state.modes.currentModeId = next.id;
      syncChips();
    } catch (_) { hooks.toast('Could not switch mode'); }
  }

  async function sendPrompt(text, view) {
    if (state.busy) return;
    if (!state.connected) {
      transcript.error('The agent isn’t connected yet. Wait a moment, or close this pane and start a new session.');
      return;
    }
    transcript.userTurn(view && view.display !== undefined ? view.display : text, view && view.files);
    state.busy = true; composer.setBusy(true); transcript.setBusy(true);
    p.working = true; if (hooks.status) hooks.status(p);
    try {
      const r = await client.prompt(text);
      if (r && r.stopReason === 'refusal') transcript.note('The agent declined that request.');
    } catch (err) {
      transcript.error((err && err.message) || 'That didn’t go through — try again.');
    }
    state.busy = false; composer.setBusy(false); transcript.setBusy(false);
    p.working = false; if (hooks.status) hooks.status(p);
    transcript.turnEnd();
    if (hooks.settled) hooks.settled(p);
  }

  const composer = createComposer(compHost, {
    onSend: (text, attachments) => {
      let full = text;
      const paths = (attachments || []).filter((a) => a && a.path).map((a) => a.path);
      const skills = (attachments || []).filter((a) => a && a.skill).map((a) => a.skill);
      if (skills.length) full += '\n\nUse the ' + skills.join(', ') + ' skill' + (skills.length > 1 ? 's' : '') + ' for this.';
      if (paths.length) full += '\n\nFiles: ' + paths.map((x) => '"' + x + '"').join(' ');
      sendPrompt(full, { display: text, files: paths });
    },
    onCommand: (name) => route(name),
    onStop: () => { if (state.connected) client.cancel(); },
    onModeCycle: cycleMode,
    onModelPick: () => route('model'),
    getBuiltins: () => {
      const rows = state.configOptions.map((co) => ({ name: co.id, description: co.name + ' — picker' }));
      rows.push({ name: 'config', description: 'Session settings' });
      rows.push({ name: 'resume', description: 'Pick up a past session' });
      return rows;
    },
    isPicker: (name) => ['config', 'settings', 'resume'].includes(name) || state.configOptions.some((co) => co.id === name && co.type === 'select'),
    onPickFiles: () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true;
      inp.onchange = () => {
        [...inp.files].forEach((f) => {
          const real = api.droppedFilePath(f) || f.name;
          composer.attach('\u{1F4CE} ' + f.name, { path: real });
        });
      };
      inp.click();
    },
  });
  rec.aiInput = composer.input;
  rec.acpAttach = (label, meta) => composer.attach(label, meta);
  composer.setSkills((window.__namiSkills || []).length ? window.__namiSkills : [
    { name: 'collector', description: 'pulls structured data off pages' },
    { name: 'engineer', description: 'edits the repo, runs tests, opens a PR' },
    { name: 'researcher', description: 'reads the web and writes a brief' },
  ]);

  async function resumePicker() {
    try {
      const r = await client.listSessions(p.cwd);
      const rows = (r.sessions || []).slice(0, 20).map((x) => ({
        name: (x.title || 'Untitled').slice(0, 52),
        description: new Date(x.updatedAt || Date.now()).toLocaleString(),
        value: x.sessionId,
      }));
      if (!rows.length) { transcript.note('No past sessions here yet.'); return; }
      composer.openSelect('Past sessions', rows, async (row) => {
        try {
          transcript.clear();
          transcript.note('Picking up \u201c' + row.name + '\u201d\u2026');
          await client.loadSession(row.value, p.cwd);
          p.acpSid = row.value;
          if (hooks.rename) hooks.rename(p, row.name);
        } catch (err) {
          transcript.error('Couldn\u2019t pick that session up \u2014 ' + ((err && err.message) || 'try another.'));
        }
      });
    } catch (err) {
      transcript.note('This agent can\u2019t list past sessions' + ((err && err.message) ? ' \u2014 ' + err.message : '') + '.');
    }
  }

  const route = createCommandRouter({
    transcript,
    composer,
    sendPrompt,
    resume: resumePicker,
    setConfigOption: async (id, value) => {
      const r = await client.setConfigOption(id, value);
      if (r && r.configOptions) mergeConfig(r.configOptions);
    },
    getState: () => state,
    refresh: syncChips,
    openTerminal: () => { if (hooks.terminal) hooks.terminal(p, composer.input.value.trim()); },
  });

  // ---- transport over the preload bridge -----------------------------------
  const msgCbs = [];
  const offMsg = api.onAcpMsg(({ id, msg }) => { if (id === p.id) msgCbs.forEach((cb) => cb(msg)); });
  const offErr = api.onAcpErr(({ id, text }) => { if (id === p.id && text.trim()) console.warn('[acp]', text.trim()); });
  const offExit = api.onAcpExit(({ id, code }) => {
    if (id !== p.id) return;
    state.connected = false;
    transcript.error('The agent stopped (exit ' + code + '). Close this pane and start a new session.');
  });
  const transport = {
    send: (o) => api.acpSend({ id: p.id, payload: o }),
    onMessage: (cb) => msgCbs.push(cb),
    onError: () => {},
    onExit: () => {},
    kill: () => api.acpKill({ id: p.id }),
  };

  const client = createAcpClient(transport, {
    onUpdate: (u) => {
      const ev = normalizeUpdate(u);
      // some agents echo your prompt back mid-turn; we already drew it
      if (ev.type === 'user' && state.busy) return;
      transcript.apply(ev);
    },
    onPermission: (params, reply) => {
      if (hooks.wake) hooks.wake(p);
      transcript.permission(params, (optionId) => {
        reply(optionId);
        if (hooks.settled) hooks.settled(p);
      }, () => { if (hooks.settled) hooks.settled(p); });
    },
    onQuestion: (params, reply) => {
      if (hooks.wake) hooks.wake(p);
      transcript.question(params, (result) => {
        reply(result);
        if (hooks.settled) hooks.settled(p);
      });
    },
  });

  rec.disposeRo = () => { offMsg && offMsg(); offErr && offErr(); offExit && offExit(); api.acpKill({ id: p.id }); };
  rec.cwFeed = (ev) => transcript.apply(ev); // scenes/screenshots replay events without an agent
  if (p.sceneStatic) return;

  (async () => {
    const launch = AGENT_LAUNCH[p.agentId] || AGENT_LAUNCH.claude;
    const started = await api.acpStart({ id: p.id, cwd: p.cwd, command: launch.command, args: launch.args });
    if (!started.ok) { transcript.error((p.title || 'The agent') + ' could not start' + (started.error ? ' — ' + started.error : '')); return; }
    try {
      const { session } = await client.connect(p.cwd);
      state.connected = true;
      p.acpSid = session.sessionId;
      state.modes = session.modes || null;
      state.configOptions = session.configOptions || [];
      syncChips();
      composer.focus();
    } catch (err) {
      transcript.error('Couldn’t connect' + ((err && err.message) ? ' — ' + err.message : '') + '. If this agent isn’t signed in yet, run it once in a terminal.');
    }
  })();
}
