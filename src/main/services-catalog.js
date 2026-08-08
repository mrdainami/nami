// What a Nami user can connect, and how each agent platform wants it written.
// Registry only: no IO here. Package names, env vars, and key pages verified
// against their READMEs and the npm registry 2026-08-08 (re-verify on change).
const KNOWN_SERVICES = [
  {
    id: 'notion', name: 'Notion', desc: 'your notes and docs', code: 'NO', kind: 'key',
    keys: [{ id: 'token', label: 'your Notion secret key', placeholder: 'ntn_...' }],
    keyHelpUrl: 'https://www.notion.so/profile/integrations',
    docs: 'https://github.com/makenotion/notion-mcp-server',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@notionhq/notion-mcp-server'], environment: { NOTION_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'slack', name: 'Slack', desc: 'your team chat', code: 'SL', kind: 'key',
    keys: [{ id: 'token', label: 'your Slack bot token', placeholder: 'xoxb-...' }],
    keyHelpUrl: 'https://api.slack.com/apps',
    docs: 'https://github.com/korotovsky/slack-mcp-server',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', 'slack-mcp-server@latest', '--transport', 'stdio'], env: { SLACK_MCP_XOXB_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', 'slack-mcp-server@latest', '--transport', 'stdio'], environment: { SLACK_MCP_XOXB_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'telegram', name: 'Telegram', desc: 'updates on your phone', code: 'TG', kind: 'key',
    keys: [{ id: 'token', label: 'your bot token (from @BotFather)', placeholder: '123456:ABC...' }],
    keyHelpUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    docs: 'https://github.com/node2flow-th/telegram-bot-mcp-community',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@node2flow/telegram-bot-mcp'], env: { TELEGRAM_BOT_TOKEN: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@node2flow/telegram-bot-mcp'], environment: { TELEGRAM_BOT_TOKEN: v.token }, enabled: true }),
  },
  {
    id: 'kie', name: 'Creative models', desc: 'make images, video, music', code: 'CM', kind: 'install',
    keys: [{ id: 'token', label: 'your KIE key', placeholder: 'kie_...' }],
    keyHelpUrl: 'https://kie.ai',
    docs: 'https://github.com/mrdainami/kie-mcp',
    repo: 'https://github.com/mrdainami/kie-mcp',
    claudeEntry: (v) => ({ command: 'node', args: [v.installDir + '/dist/index.js'], env: { KIE_API_KEY: v.token } }),
    opencodeEntry: (v) => ({ type: 'local', command: ['node', v.installDir + '/dist/index.js'], environment: { KIE_API_KEY: v.token }, enabled: true }),
  },
  {
    id: 'folder', name: 'A folder', desc: 'read and edit one chosen folder', code: 'FS', kind: 'folder',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    claudeEntry: (v) => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', v.folder] }),
    opencodeEntry: (v) => ({ type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-filesystem', v.folder], enabled: true }),
  },
  {
    id: 'gmail', name: 'Gmail', desc: 'read and reply to email', code: 'GM', kind: 'guided',
    keys: [],
    docs: 'https://github.com/GongRzhe/Gmail-MCP-Server',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    claudeEntry: () => ({ command: 'npx', args: ['@gongrzhe/server-gmail-autoauth-mcp'] }),
    opencodeEntry: () => ({ type: 'local', command: ['npx', '@gongrzhe/server-gmail-autoauth-mcp'], enabled: true }),
  },
  {
    id: 'gdrive', name: 'Google Drive', desc: 'your files', code: 'GD', kind: 'guided',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    claudeEntry: () => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] }),
    opencodeEntry: () => ({ type: 'local', command: ['npx', '-y', '@modelcontextprotocol/server-gdrive'], enabled: true }),
  },
];
function serviceById(id) { return KNOWN_SERVICES.find((s) => s.id === id) || null; }
module.exports = { KNOWN_SERVICES, serviceById };
