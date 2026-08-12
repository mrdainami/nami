// What a Nami user can connect. Registry only: no IO here. Package names, env
// vars, and key pages verified against their READMEs and the npm registry
// 2026-08-08 (re-verify on change).
//
// One recipe per service — `entry(values)` in the standard mcpServers shape the
// master file stores verbatim. Platform dialects are not this file's business:
// connections.js translates on delivery, so adding a platform never reopens the
// catalog. claudeEntry/opencodeEntry remain as thin derivations for callers not
// yet moved to the master flow.
const { toOpencode } = require('./connections');

const KNOWN_SERVICES = [
  {
    id: 'notion', name: 'Notion', desc: 'your notes and docs', code: 'NO', kind: 'key',
    keys: [{ id: 'token', label: 'your Notion secret key', placeholder: 'ntn_...' }],
    keyHelpUrl: 'https://www.notion.so/profile/integrations',
    docs: 'https://github.com/makenotion/notion-mcp-server',
    entry: (v) => ({ command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: v.token } }),
  },
  {
    id: 'slack', name: 'Slack', desc: 'your team chat', code: 'SL', kind: 'key',
    keys: [{ id: 'token', label: 'your Slack bot token', placeholder: 'xoxb-...' }],
    keyHelpUrl: 'https://api.slack.com/apps',
    docs: 'https://github.com/korotovsky/slack-mcp-server',
    entry: (v) => ({ command: 'npx', args: ['-y', 'slack-mcp-server@latest', '--transport', 'stdio'], env: { SLACK_MCP_XOXB_TOKEN: v.token } }),
  },
  {
    id: 'telegram', name: 'Telegram', desc: 'updates on your phone', code: 'TG', kind: 'key',
    keys: [{ id: 'token', label: 'your bot token (from @BotFather)', placeholder: '123456:ABC...' }],
    keyHelpUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
    docs: 'https://github.com/node2flow-th/telegram-bot-mcp-community',
    entry: (v) => ({ command: 'npx', args: ['-y', '@node2flow/telegram-bot-mcp'], env: { TELEGRAM_BOT_TOKEN: v.token } }),
  },
  {
    id: 'kie', name: 'Creative models', desc: 'make images, video, music', code: 'CM', kind: 'install',
    keys: [{ id: 'token', label: 'your KIE key', placeholder: 'kie_...' }],
    keyHelpUrl: 'https://kie.ai',
    docs: 'https://github.com/mrdainami/kie-mcp',
    repo: 'https://github.com/mrdainami/kie-mcp',
    entry: (v) => ({ command: 'node', args: [v.installDir + '/dist/index.js'], env: { KIE_API_KEY: v.token } }),
  },
  {
    id: 'folder', name: 'A folder', desc: 'read and edit one chosen folder', code: 'FS', kind: 'folder',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    entry: (v) => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', v.folder] }),
  },
  {
    id: 'gmail', name: 'Gmail', desc: 'read and reply to email', code: 'GM', kind: 'guided',
    keys: [],
    docs: 'https://github.com/GongRzhe/Gmail-MCP-Server',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    entry: () => ({ command: 'npx', args: ['@gongrzhe/server-gmail-autoauth-mcp'] }),
  },
  {
    id: 'gdrive', name: 'Google Drive', desc: 'your files', code: 'GD', kind: 'guided',
    keys: [],
    docs: 'https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive',
    guide: 'Google asks for a short sign-in setup (about 5 minutes). A session with your agent walks you through it and finishes the connection.',
    entry: () => ({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-gdrive'] }),
  },
];
for (const s of KNOWN_SERVICES) {
  s.claudeEntry = s.entry;
  s.opencodeEntry = (v) => toOpencode(s.entry(v));
}
function serviceById(id) { return KNOWN_SERVICES.find((s) => s.id === id) || null; }
module.exports = { KNOWN_SERVICES, serviceById };
