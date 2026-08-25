// ACP client — transport-agnostic. The same class drives the Electron pane
// (transport = preload bridge) and the node fixture recorder (transport =
// child_process stdio), so the recorder exercises the exact code the app runs.
//
// Transport contract:
//   transport.send(obj)            write one JSON-RPC message
//   transport.onMessage(cb)        parsed JSON-RPC messages from the agent
//   transport.onError(cb)          stderr text lines (diagnostic only)
//   transport.onExit(cb)           process exit code
//   transport.kill()

export function createAcpClient(transport, handlers) {
  const h = handlers || {};
  let nextId = 1;
  const pending = new Map();
  let sessionId = null;

  function call(method, params) {
    const id = nextId++;
    transport.send({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  function respond(id, result) { transport.send({ jsonrpc: '2.0', id, result }); }
  function respondError(id, code, message) { transport.send({ jsonrpc: '2.0', id, error: { code, message } }); }

  transport.onMessage((msg) => {
    if (h.onRaw) h.onRaw('recv', msg);
    // response to one of our calls
    if (msg.id !== undefined && !msg.method) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(msg.error.message || 'agent error'), { code: msg.error.code })) : p.resolve(msg.result); }
      return;
    }
    // notifications + requests from the agent
    if (msg.method === 'session/update') {
      const u = (msg.params && (msg.params.update || msg.params)) || {};
      if (h.onUpdate) h.onUpdate(u);
      return;
    }
    if (msg.method === 'session/request_permission') {
      const params = msg.params || {};
      const reply = (optionId) => respond(msg.id, { outcome: { outcome: 'selected', optionId } });
      const cancel = () => respond(msg.id, { outcome: { outcome: 'cancelled' } });
      if (h.onPermission) h.onPermission(params, reply, cancel);
      else cancel();
      return;
    }
    // capabilities we do not grant — refuse honestly
    if (msg.id !== undefined) respondError(msg.id, -32601, 'not supported');
  });
  transport.onError((text) => { if (h.onStderr) h.onStderr(text); });
  transport.onExit((code) => { if (h.onExit) h.onExit(code); });

  return {
    async connect(cwd) {
      const init = await call('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      const sess = await call('session/new', { cwd, mcpServers: [] });
      sessionId = sess.sessionId;
      return { init, session: sess };
    },
    prompt(text) {
      return call('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
    },
    setMode(modeId) { return call('session/set_mode', { sessionId, modeId }); },
    setConfigOption(configId, value) { return call('session/set_config_option', { sessionId, configId, value }); },
    cancel() { transport.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); },
    kill() { transport.kill(); },
    get sessionId() { return sessionId; },
    _send(obj) { transport.send(obj); },
  };
}

// The one place raw protocol updates become the typed events the renderer
// consumes. Every unknown kind maps to {type:'unknown'} so the renderer can
// prove (in tests) that no fixture event falls through.
export function normalizeUpdate(u) {
  switch (u.sessionUpdate) {
    case 'agent_message_chunk':
      return u.content && u.content.type === 'text' ? { type: 'message', text: u.content.text } : { type: 'ignore' };
    case 'agent_thought_chunk':
      return u.content && u.content.type === 'text' ? { type: 'thought', text: u.content.text } : { type: 'ignore' };
    case 'user_message_chunk':
      return { type: 'ignore' };
    case 'tool_call':
      return { type: 'tool', id: u.toolCallId, title: u.title || '', kind: u.kind || 'other', status: u.status || 'pending', content: u.content || [], locations: u.locations || [] };
    case 'tool_call_update':
      return { type: 'tool_update', id: u.toolCallId, status: u.status, content: u.content || [], title: u.title };
    case 'plan':
      return { type: 'plan', entries: (u.entries || []).map((e) => ({ text: e.content, status: e.status })) };
    case 'available_commands_update':
      return { type: 'commands', commands: (u.availableCommands || []).map((c) => ({ name: c.name, description: c.description || '' })) };
    case 'current_mode_update':
      return { type: 'mode', modeId: u.currentModeId };
    case 'usage_update':
      return { type: 'usage', used: u.used, size: u.size };
    case 'session_info_update':
      return { type: 'info', title: u.title };
    default:
      return { type: 'unknown', raw: u };
  }
}
