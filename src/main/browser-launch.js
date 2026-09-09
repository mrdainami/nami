// Per-process configuration only. Never write a session bearer into project or
// global MCP settings, and never replace the user's other configured servers.
// Claude and Codex have a documented per-run MCP flag; other CLIs get host-
// attached page snapshots from the session chip instead.
function browserLaunchArgs(agent, connection) {
  if (!connection?.url) return [];
  if (agent === 'claude') return ['--mcp-config', JSON.stringify({mcpServers:{'nami-browser':{type:'http',url:connection.url}}})];
  if (agent === 'codex') return ['-c', `mcp_servers."nami-browser".url=${JSON.stringify(connection.url)}`];
  return [];
}
module.exports = { browserLaunchArgs };
