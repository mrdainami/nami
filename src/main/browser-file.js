const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL, fileURLToPath } = require('url');
const { userBrowserUrl } = require('./browser-policy');

// The renderer can ask for a local page to leave Nami's sandbox, so this gate
// is intentionally narrower than "anything a browser might display". A real,
// absolute HTML file is the product use-case; every other scheme, extension,
// missing path and directory is refused before shell.openExternal sees it.
function browserFileUrl(file, deps = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  if (!/\.html?$/i.test(path.basename(file))) return null;
  try {
    const stat = (deps.statSync || fs.statSync)(file);
    if (!stat.isFile()) return null;
  } catch (_) { return null; }
  return pathToFileURL(file).href;
}

// Only the trusted human address bar uses this resolver. Website and agent
// navigation continue to use browserUrl, which cannot authorize local files.
function resolveBrowserInput(value, { homePath = os.homedir() } = {}) {
  let text = String(value || '').trim();
  if (/^["'](?:\/|~\/|file:|[a-zA-Z]:[\\/])/i.test(text)) {
    if (text.at(-1) !== text[0]) throw new Error('Close the quote around the file path.');
    text = text.slice(1, -1);
  }
  const local = /^(?:\/|~\/|file:|[a-zA-Z]:[\\/])/i.test(text);
  if (!local) return { url: userBrowserUrl(text) };
  if (text.includes('\0')) throw new Error('Invalid file path.');
  let file = text, suffix = '';
  if (/^file:/i.test(text)) {
    try {
      const url = new URL(text);
      file = fileURLToPath(url);
      suffix = url.search + url.hash;
    } catch { throw new Error('Enter a valid local file URL.'); }
  } else if (text.startsWith('~/')) file = path.join(homePath, text.slice(2));
  try {
    file = fs.realpathSync(file);
    if (!/\.html?$/i.test(file) || !fs.statSync(file).isFile()) throw new Error('Choose an HTML file (.html or .htm).');
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw new Error('HTML file not found. Check the path and try again.');
    if (['EACCES', 'EPERM'].includes(error.code)) throw new Error('Nami cannot read this HTML file. Check its file permissions.');
    throw error;
  }
  return { filePath: file, url: pathToFileURL(file).href + suffix };
}

module.exports = { browserFileUrl, resolveBrowserInput };
