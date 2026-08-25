// Chat pane — assembles client + transcript + composer + command router into
// a live tile. This is the only file that knows about both the protocol side
// and the app side (attention, openFile, toast, renaming).

import { createAcpClient, normalizeUpdate } from './acp-client.mjs';
import { createTranscript } from './acp-render.mjs';
import { createComposer } from './acp-composer.mjs';
import { createCommandRouter } from './acp-commands.mjs';

const ADAPTER_BIN = decodeURIComponent(new URL('../../acp-tools/node_modules/.bin/claude-agent-acp', location.href).pathname);

export function mountChatPane(p, rec, hooks) {
  const api = window.dainami;
  const body = rec.body;
  body.classList.add('cw-body');
  body.innerHTML = '<div class="cw-transcript"></div><div class="cw-composer-host"></div>';
  const scrollHost = body.querySelector('.cw-transcript');
  const compHost = body.querySelector('.cw-composer-host');

  const empty = document.createElement('div');
  empty.className = 'cw-empty';
  empty.textContent = 'Write a message to start — / shows commands';
  scrollHost.appendChild(empty);
  new MutationObserver(() => {
    if (scrollHost.children.length > 1 && empty.parentElement) empty.remove();
  }).observe(scrollHost, { childList: true });

  const state = { commands: [], configOptions: [], modes: null, busy: false, connected: false };

  const transcript = createTranscript(scrollHost, {
    onLink: (url) => { if (/^https?:/.test(url)) api.openFileInBrowser ? window.open(url) : window.open(url); else hooks.open(url); },
    onCopy: (text) => { api.copyText(text); hooks.toast('Copied'); },
    onOpenFile: (path) => hooks.open(path),
    onCommands: (list) => { state.commands = list; composer.setCommands(list); },
    onUsage: (used, size) => composer.setUsage(used, size),
    onInfo: (title) => { if (title && hooks.rename) hooks.rename(p, title); },
    onMode: (modeId) => { if (state.modes) { state.modes.currentModeId = modeId; syncChips(); } },
  });

  function currentCfg(id) { return state.configOptions.find((c) => c.id === id); }
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

  async function sendPrompt(text) {
    if (!state.connected || state.busy) return;
    transcript.userTurn(text);
    state.busy = true; composer.setBusy(true);
    try {
      const r = await client.prompt(text);
      if (r && r.stopReason === 'refusal') transcript.note('Claude declined that request.');
    } catch (err) {
      transcript.error((err && err.message) || 'That didn’t go through — try again.');
    }
    state.busy = false; composer.setBusy(false);
    transcript.turnEnd();
    if (hooks.settled) hooks.settled(p);
  }

  const composer = createComposer(compHost, {
    onSend: (text, attachments) => {
      let full = text;
      const paths = (attachments || []).filter((a) => a && a.path).map((a) => a.path);
      const skills = (attachments || []).filter((a) => a && a.skill).map((a) => a.skill);
      if (skills.length) full += '\n\nUse the ' + skills.join(', ') + ' skill' + (skills.length > 1 ? 's' : '') + ' for this.';
      if (paths.length) full += '\n\nFiles: ' + paths.join(' ');
      sendPrompt(full);
    },
    onCommand: (name) => route(name),
    onStop: () => { if (state.connected) client.cancel(); },
    onModeCycle: cycleMode,
    onModelPick: () => route('model'),
  });
  rec.aiInput = composer.input;
  rec.acpAttach = (label, meta) => composer.attach(label, meta);
  composer.setSkills((window.__namiSkills || []).length ? window.__namiSkills : [
    { name: 'collector', description: 'pulls structured data off pages' },
    { name: 'engineer', description: 'edits the repo, runs tests, opens a PR' },
    { name: 'researcher', description: 'reads the web and writes a brief' },
  ]);

  const route = createCommandRouter({
    transcript,
    composer,
    sendPrompt,
    setConfigOption: async (id, value) => {
      const r = await client.setConfigOption(id, value);
      if (r && r.configOptions) { state.configOptions = r.configOptions; syncChips(); }
    },
    getState: () => state,
    refresh: syncChips,
  });

  // ---- transport over the preload bridge -----------------------------------
  const msgCbs = [];
  const offMsg = api.onAcpMsg(({ id, msg }) => { if (id === p.id) msgCbs.forEach((cb) => cb(msg)); });
  const offErr = api.onAcpErr(({ id, text }) => { if (id === p.id && text.trim()) console.warn('[acp]', text.trim()); });
  const offExit = api.onAcpExit(({ id, code }) => {
    if (id !== p.id) return;
    state.connected = false;
    transcript.error('Claude Code stopped (exit ' + code + '). Close this pane and start a new session.');
  });
  const transport = {
    send: (o) => api.acpSend({ id: p.id, payload: o }),
    onMessage: (cb) => msgCbs.push(cb),
    onError: () => {},
    onExit: () => {},
    kill: () => api.acpKill({ id: p.id }),
  };

  const client = createAcpClient(transport, {
    onUpdate: (u) => transcript.apply(normalizeUpdate(u)),
    onPermission: (params, reply) => {
      if (hooks.wake) hooks.wake(p);
      transcript.permission(params, (optionId) => {
        reply(optionId);
        if (hooks.settled) hooks.settled(p);
      });
    },
  });

  (async () => {
    const started = await api.acpStart({ id: p.id, cwd: p.cwd, command: ADAPTER_BIN, args: [] });
    if (!started.ok) { transcript.error('Claude Code could not start' + (started.error ? ' — ' + started.error : '')); return; }
    try {
      const { session } = await client.connect(p.cwd);
      state.connected = true;
      state.modes = session.modes || null;
      state.configOptions = session.configOptions || [];
      syncChips();
      composer.focus();
    } catch (err) {
      transcript.error('Couldn’t connect' + ((err && err.message) ? ' — ' + err.message : '') + '. If you haven’t signed in to Claude Code yet, run it once in a terminal.');
    }
  })();

  rec.disposeRo = () => { offMsg && offMsg(); offErr && offErr(); offExit && offExit(); api.acpKill({ id: p.id }); };
}
