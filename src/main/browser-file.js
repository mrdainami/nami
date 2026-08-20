const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

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

module.exports = { browserFileUrl };
