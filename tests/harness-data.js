// Synthetic protocol examples only. Never record a real conversation here.
(() => {
  const tape = [];
  const recv = (msg) => tape.push({ dir: 'recv', msg });
  const update = (value) => recv({ method: 'session/update', params: { update: value } });
  recv({ id: 2, result: {
    configOptions: [
      { id: 'model', name: 'Model', type: 'select', currentValue: 'sonnet', options: ['Sonnet', 'Opus', 'Haiku', 'Default'].map((name) => ({ value: name.toLowerCase(), name })) },
      { id: 'mode', name: 'Mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'plan', name: 'Plan' }] },
    ],
    modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] },
  } });
  tape.push({ dir: 'send', msg: { method: 'session/prompt', params: { prompt: [{ type: 'text', text: 'Review `example.txt`.' }] } } });
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I will inspect the example.' } });
  update({ sessionUpdate: 'plan', entries: [{ content: 'Review the example', status: 'completed' }] });
  update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact the conversation' }] });
  update({ sessionUpdate: 'usage_update', used: 100, size: 1000 });
  update({ sessionUpdate: 'session_info_update', title: 'Example review' });
  for (let i = 0; i < 5; i++) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Example reply. [Docs](https://example.com)\n\n```js\nconst example = true;\n```' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 'example-tool-' + i, title: 'Read example.txt', kind: 'read', status: 'pending', content: [{ type: 'content', content: { type: 'text', text: 'Example tool output.' } }] });
    if (i === 0) recv({ method: 'session/request_permission', params: { toolCall: { toolCallId: 'example-tool-0', title: 'Read example.txt' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }] } });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'example-tool-' + i, status: 'completed', content: i === 1 ? [{ type: 'diff', path: '/tmp/example.txt', oldText: '', newText: 'one\ntwo\nthree\nfour' }] : [] });
  }
  recv({ method: 'session/request_permission', params: { toolCall: { toolCallId: 'example-pending', title: 'Another example' }, options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }] } });
  window.FIXTURES = { chat: tape };
})();
