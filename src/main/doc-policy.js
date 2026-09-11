// 'self' alone covers every encoded root on nami-doc://doc. Restrict resource
// URLs to this document's folder, including nested frames and script imports.
function documentPolicy(root) {
  const encoded = encodeURIComponent(root).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const source = 'nami-doc://doc/' + encoded + '/';
  return `default-src ${source} data: blob:; img-src ${source} data: blob:; `
    + `style-src ${source} 'unsafe-inline'; script-src ${source} 'unsafe-inline'; font-src ${source} data:; `
    + `media-src ${source} data: blob:; frame-src ${source}; worker-src 'none'; connect-src 'none'; `
    + `object-src 'none'; base-uri ${source}; form-action 'none';`;
}
module.exports = { documentPolicy };
