// What each agent CLI says about who is signed in — pure, no IO.
// One rule governs this whole file: nothing that could be a secret ever reaches
// a row. We read labels, provider names, plans and paths; never a token, key or
// fingerprint. Callers do the IO and hand the payload in, so every parser here
// is testable against a captured fixture with no CLI on the box.
//
// Payload shapes, captured on macOS 2026-08-09:
//   claude   { stdout }  — `claude auth status --json`, the only CLI of the six
//                          with a machine-readable status command
//   hermes   { files }   — ~/.hermes/auth.json + ~/.hermes/config.yaml
//                          (`hermes auth status` demands a provider argument)
//   opencode { files }   — ~/.local/share/opencode/auth.json
//                          (`opencode auth list` prints decorated prose)
//   codex    { files }   — ~/.codex/auth.json
//   grok     { files }   — ~/.grok/auth.json (a map, keyed issuer::client_id)

const UNKNOWN = () => ({ signedIn: null, label: '', rows: [] });
const SIGNED_OUT = () => ({ signedIn: false, label: 'signed out', rows: [] });

// Tolerant on purpose. Status commands run through an interactive login shell
// (the only kind that reads .zshrc, where PATH lives), so a version manager or
// a shell greeting can print ahead of the JSON we asked for. A strict parse
// would read that greeting as "signed out".
function readJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try { return JSON.parse(text); } catch (_) { /* fall through to the salvage */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
}
function onlyFile(payload) {
  const files = (payload && payload.files) || {};
  const key = Object.keys(files)[0];
  return key === undefined ? undefined : files[key];
}
function fileEndingWith(payload, suffix) {
  const files = (payload && payload.files) || {};
  const key = Object.keys(files).find((k) => k.endsWith(suffix));
  return key === undefined ? undefined : files[key];
}

// "openrouter/anthropic/claude-sonnet-4-6" → "claude-sonnet-4-6"
function shortModel(slug) {
  const parts = String(slug || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

// The repo has no YAML parser and won't gain one for two keys. Match the
// `model:` block's `default:` and `provider:` lines, stop at the first dedent,
// and give up (null) on anything unexpected — the model row is a bonus.
function hermesModelFromYaml(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const start = lines.findIndex((l) => /^model:\s*$/.test(l));
  if (start < 0) return null;
  const out = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const m = /^\s+(default|provider):\s*(.+?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return (out.default || out.provider) ? out : null;
}

function parseClaude(payload) {
  const j = readJson(payload && payload.stdout);
  if (!j || typeof j.loggedIn !== 'boolean') return UNKNOWN();
  if (!j.loggedIn) return SIGNED_OUT();
  const plan = j.subscriptionType ? String(j.subscriptionType) : '';
  const planLabel = plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '';
  const rows = [];
  if (j.email) rows.push({ k: 'Account', v: String(j.email) });
  if (planLabel) rows.push({ k: 'Plan', v: planLabel });
  if (j.authMethod) rows.push({ k: 'Signed in', v: 'through ' + String(j.authMethod) });
  if (j.orgName) rows.push({ k: 'Team', v: String(j.orgName) });
  const label = [j.email, planLabel].filter(Boolean).join(' · ') || 'signed in';
  return { signedIn: true, label, rows };
}

function parseHermes(payload) {
  const auth = readJson(fileEndingWith(payload, 'auth.json'));
  if (!auth) return UNKNOWN();
  const pool = (auth.credential_pool && typeof auth.credential_pool === 'object') ? auth.credential_pool : {};
  const providers = Object.keys(pool).filter((p) => Array.isArray(pool[p]) && pool[p].length).sort();
  const total = providers.reduce((n, p) => n + pool[p].length, 0);
  if (!total) return SIGNED_OUT();

  const rows = [];
  const model = hermesModelFromYaml(fileEndingWith(payload, 'config.yaml'));
  const modelName = model ? shortModel(model.default) : '';
  const via = model && model.default ? String(model.default).split('/')[0] : '';
  if (modelName) rows.push({ k: 'Model', v: via && via !== modelName ? `${modelName}, via ${via}` : modelName });
  if (model && model.provider) rows.push({ k: 'Provider', v: model.provider });
  rows.push({ k: 'Sign-ins', v: providers.map((p) => (pool[p].length > 1 ? `${p} ×${pool[p].length}` : p)).join(', ') });

  const count = `${total} sign-in${total === 1 ? '' : 's'}`;
  return { signedIn: true, label: [modelName, count].filter(Boolean).join(' · '), rows };
}

function parseOpencode(payload) {
  const j = readJson(onlyFile(payload));
  if (!j) return UNKNOWN();
  const providers = Object.keys(j).sort();
  if (!providers.length) return SIGNED_OUT();
  return { signedIn: true, label: providers.join(', '), rows: [{ k: 'Sign-ins', v: providers.join(', ') }] };
}

function parseCodex(payload) {
  const j = readJson(onlyFile(payload));
  if (!j) return UNKNOWN();
  const hasTokens = !!(j.tokens && j.tokens.account_id);
  const hasKey = typeof j.OPENAI_API_KEY === 'string' && j.OPENAI_API_KEY.length > 0;
  if (!hasTokens && !hasKey) return SIGNED_OUT();
  const rows = [];
  const label = hasTokens ? 'signed in through your ChatGPT account' : 'signed in with an API key';
  rows.push({ k: 'Signed in', v: hasTokens ? 'through your ChatGPT account' : 'with an API key' });
  if (hasTokens && typeof j.last_refresh === 'string' && /^\d{4}-\d{2}-\d{2}/.test(j.last_refresh)) {
    rows.push({ k: 'Last renewed', v: j.last_refresh.slice(0, 10) });
  }
  return { signedIn: true, label, rows };
}

// grok keeps ~/.grok/auth.json as a MAP keyed "<issuer>::<client_id>", not a
// flat record — one entry per place you have signed in, so the newest
// create_time is the one the CLI is using. Everything interesting sits beside
// two things that must never leave this function: `key` (a JWT) and
// `refresh_token`.
function parseGrok(payload) {
  const j = readJson(onlyFile(payload));
  if (!j || typeof j !== "object") return UNKNOWN();
  const entries = Object.values(j).filter((v) => v && typeof v === "object");
  if (!entries.length) return SIGNED_OUT();
  // newest sign-in wins; an entry with no timestamp sorts last, never first
  const a = entries.slice().sort((x, y) =>
    (Date.parse(y.create_time) || 0) - (Date.parse(x.create_time) || 0))[0];
  const email = typeof a.email === "string" ? a.email.trim() : "";
  const byKey = a.auth_mode === "api_key";
  if (!email && !byKey && !a.auth_mode) return SIGNED_OUT();
  const rows = [];
  if (email) rows.push({ k: "Account", v: email });
  if (typeof a.first_name === "string" && a.first_name.trim() && email) {
    rows.push({ k: "Name", v: a.first_name.trim() });
  }
  rows.push({ k: "Signed in", v: byKey ? "with an API key" : "through your xAI account" });
  return {
    signedIn: true,
    label: email || (byKey ? "signed in with an API key" : "signed in"),
    rows,
  };
}

const PARSERS = { claude: parseClaude, hermes: parseHermes, opencode: parseOpencode, codex: parseCodex, grok: parseGrok };

function parseAgentStatus(id, payload) {
  const fn = PARSERS[id];
  if (!fn) return UNKNOWN();
  try { return fn(payload || {}); } catch (_) { return UNKNOWN(); }
}

module.exports = { parseAgentStatus, hermesModelFromYaml, shortModel };
