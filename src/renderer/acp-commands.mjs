// Command routing — the one place a typed /command becomes an action.
//
//   · A command matching a typed config option (model / mode / effort / agent
//     / config) opens a native picker built from the agent's own option data
//     and applies the choice with session/set_config_option. Nothing sent as
//     chat.
//   · Any other advertised command is sent as a prompt turn — that is how the
//     protocol executes commands — and the reply streams back.
//   · An unlisted command still sends, with a small note first: honest,
//     never a dead end.

export function createCommandRouter(ctx) {
  // ctx: { transcript, composer, sendPrompt(text), setConfigOption(id, value),
  //        setMode(modeId), getState() -> { commands, configOptions, modes } }

  function configById(id) {
    const st = ctx.getState();
    return (st.configOptions || []).find((c) => c.id === id);
  }
  function pickerRows(co) {
    return (co.options || []).map((o) => ({
      name: o.name || o.value,
      description: o.description || '',
      value: o.value,
      current: o.value === co.currentValue || (o.name && o.name === co.currentValue),
    }));
  }
  function openConfigPicker(co) {
    ctx.composer.openSelect(co.name, pickerRows(co), async (row) => {
      try {
        await ctx.setConfigOption(co.id, row.value);
        ctx.transcript.note(co.name + ' → ' + row.name);
        ctx.refresh && ctx.refresh();
      } catch (err) {
        ctx.transcript.error(co.name + ' change failed — ' + ((err && err.message) || 'try again'));
      }
    });
  }

  function openSettings() {
    const st = ctx.getState();
    const rows = (st.configOptions || []).map((co) => ({
      name: co.name,
      description: String(co.currentValueLabel || co.currentValue || ''),
      value: co.id,
    }));
    if (!rows.length) { ctx.transcript.note('No settings here yet — this agent keeps them in its own config.'); return; }
    ctx.composer.openSelect('Settings', rows, (row) => {
      const co = configById(row.value);
      if (co && co.type === 'select') openConfigPicker(co);
      else ctx.transcript.note(row.name + ' can’t be changed from here yet.');
    });
  }

  return function route(name) {
    const st = ctx.getState();
    // typed config options become native pickers — /model, /mode, /effort…
    const co = configById(name);
    if (co && co.type === 'select') { openConfigPicker(co); return; }
    if (name === 'config' || name === 'settings') { openSettings(); return; }
    if (name === 'resume' && ctx.resume) { ctx.resume(); return; }
    const known = (st.commands || []).some((c) => c.name === name);
    if (known) { ctx.sendPrompt('/' + name); return; }
    // not on this agent's wire — never pretend, never dead-end
    ctx.transcript.action(
      ['model', 'mode', 'effort'].includes(name)
        ? 'This agent doesn’t support ' + name + ' switching in chat yet.'
        : '/' + name + ' isn’t available in chat for this agent.',
      'Open terminal',
      () => { if (ctx.openTerminal) ctx.openTerminal(); });
  };
}
