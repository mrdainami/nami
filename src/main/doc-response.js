const fs = require('node:fs/promises');
const { Readable } = require('node:stream');
const { docContentType } = require('./doc-protocol');

// A malformed or unsupported range may be ignored. A valid range beyond EOF
// must instead return 416, so the media element can recover its file position.
function byteRange(value, size) {
  if (!value || value.length > 512) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const length = BigInt(size);
  if (!match[1]) {
    const suffix = BigInt(match[2]);
    if (!suffix || !length) return { unsatisfiable: true };
    return { start: Number(suffix >= length ? 0n : length - suffix), end: size - 1 };
  }
  const start = BigInt(match[1]), end = match[2] ? BigInt(match[2]) : length - 1n;
  if (match[2] && end < start) return null;
  if (start >= length) return { unsatisfiable: true };
  return { start: Number(start), end: Number(end >= length ? length - 1n : end) };
}

// Callers must authorize and resolve the path before serving it. Keeping that
// gate outside lets browser partitions and saved previews retain their own
// root policy while sharing correct streamed file and media responses.
async function serveDocFile(file, request, csp) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const headers = new Headers({
      'Content-Type': docContentType(file),
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Content-Security-Policy': csp,
    });
    // No validators are issued here. An If-Range request therefore gets a full
    // response rather than combining bytes with an unverified cached version.
    const range = request.method === 'GET' && !request.headers.has('if-range')
      ? byteRange(request.headers.get('range'), stat.size) : null;
    if (range?.unsatisfiable) {
      headers.set('Content-Range', 'bytes */' + stat.size);
      headers.set('Content-Length', '0');
      return new Response(null, { status: 416, headers });
    }
    const start = range?.start || 0, end = range?.end ?? stat.size - 1;
    if (range) {
      headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      headers.set('Content-Length', String(end - start + 1));
    }
    const status = range ? 206 : 200;
    if (request.method === 'HEAD' || stat.size === 0) return new Response(null, { status, headers });
    const stream = handle.createReadStream({ start, end, autoClose: true, signal: request.signal });
    const body = Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: chunk => chunk.byteLength } });
    handle = null; // Stream completion/cancellation now owns closing the file.
    return new Response(body, { status, headers });
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) return new Response('Not found', { status: 404 });
    throw error;
  } finally { await handle?.close(); }
}

module.exports = { serveDocFile };
