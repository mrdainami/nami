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
  let sessionId = null, loadingSessionId = null, startingSession = false, startingUpdates = [];
  let capabilities = {}, requestedMcp = [], configuredMcp = [];
  const eligibleMcp = (servers) => (Array.isArray(servers) ? servers : []).filter((server) => {
    if (server?.type === 'http') return capabilities.mcpCapabilities?.http === true;
    if (server?.type === 'sse') return capabilities.mcpCapabilities?.sse === true;
    return typeof server?.command === 'string';
  }).map((server) => ({ ...server, ...(server.type ? { headers: server.headers || [] } : { args: server.args || [], env: server.env || [] }) }));

  function call(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        Promise.resolve(transport.send({ jsonrpc: '2.0', id, method, params })).then((result) => {
          if (result?.ok === false && pending.has(id)) { pending.delete(id); reject(new Error(result.error || 'The agent could not receive this request.')); }
        }, (error) => { pending.delete(id); reject(error); });
      } catch (error) { pending.delete(id); reject(error); }
    });
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
      const incomingSessionId = msg.params?.sessionId;
      if (typeof incomingSessionId !== 'string') return;
      if (startingSession) { if (startingUpdates.length < 200) startingUpdates.push(msg); return; }
      if (incomingSessionId !== (loadingSessionId || sessionId)) return;
      const u = msg.params.update || {};
      if (h.onUpdate) h.onUpdate(u);
      return;
    }
    if (msg.method === 'elicitation/create') {
      const params = msg.params || {};
      const reply = (result) => respond(msg.id, result);
      if (h.onQuestion) h.onQuestion(params, reply);
      else reply({ action: 'cancel' });
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
  transport.onExit((code) => { for (const request of pending.values()) request.reject(new Error('The agent stopped before responding.')); pending.clear(); if (h.onExit) h.onExit(code); });

  return {
    async connect(cwd, { mcpServers = [] } = {}) {
      const init = await call('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } },
      });
      capabilities = init.agentCapabilities || {};
      requestedMcp = mcpServers; configuredMcp = eligibleMcp(requestedMcp);
      startingSession = true;
      try {
        const sess = await call('session/new', { cwd, mcpServers: configuredMcp });
        sessionId = sess.sessionId;
        for (const message of startingUpdates) if (message.params.sessionId === sessionId) h.onUpdate?.(message.params.update || {});
        return { init, session: sess };
      } finally { startingSession = false; startingUpdates = []; }
    },
    prompt(text, { images = [] } = {}) {
      if (images.length && capabilities.promptCapabilities?.image !== true) return Promise.reject(new Error('This agent does not support image prompts. Use a file reference instead.'));
      if (images.length > 12 || images.reduce((size, image) => size + (image?.data?.length || 0), 0) > 32 * 1024 * 1024 || images.some(image => image?.type !== 'image' || typeof image.data !== 'string' || image.data.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) || image.data.length % 4 !== 0 || !/^image\/(png|jpeg|webp|gif)$/.test(image.mimeType))) return Promise.reject(new Error('Invalid image attachment.'));
      return call('session/prompt', { sessionId, prompt: [{ type: 'text', text: String(text) }, ...images.map(({ data, mimeType }) => ({ type: 'image', data, mimeType }))] });
    },
    setMode(modeId) { return call('session/set_mode', { sessionId, modeId }); },
    setConfigOption(configId, value) { return call('session/set_config_option', { sessionId, configId, value }); },
    listSessions(cwd) { return call('session/list', { cwd }); },
    async loadSession(sid, cwd, options = {}) {
      if (capabilities.loadSession !== true) throw new Error('This agent does not support loading sessions.');
      requestedMcp = options.mcpServers || requestedMcp;
      configuredMcp = eligibleMcp(requestedMcp);
      if (loadingSessionId) throw new Error('Another session is already loading.');
      loadingSessionId = sid;
      try {
        if (options.beforeLoad) await options.beforeLoad();
        const r = await call('session/load', { sessionId: sid, cwd, mcpServers: configuredMcp });
        sessionId = sid; return r;
      } finally { loadingSessionId = null; }
    },
    cancel() { transport.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); },
    kill() { transport.kill(); },
    get sessionId() { return sessionId; },
    get capabilities() { return { image: capabilities.promptCapabilities?.image === true, mcpHttp: capabilities.mcpCapabilities?.http === true, mcpSse: capabilities.mcpCapabilities?.sse === true, loadSession: capabilities.loadSession === true, configuredMcp: configuredMcp.map(({ name, type }) => ({ name, type: type || 'stdio' })) }; },
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
      return u.content && u.content.type === 'text' ? { type: 'user', text: u.content.text } : { type: 'ignore' };
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
    case 'config_options_update':
    case 'current_config_update':
    case 'session_config_update':
      return { type: 'config', configOptions: u.configOptions || null };
    default:
      return { type: 'unknown', raw: u };
  }
}
