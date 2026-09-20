const { fileURLToPath } = require('node:url');

// Only registered application windows may call the privileged app bridge.
// Guests and their subframes have their own narrowly checked message channels.
function trustedAppSender(event, windows, appUrl) {
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed() || !event.senderFrame || event.senderFrame !== sender.mainFrame) return false;
    // Compared as files, not as strings. Node spells C:\Users\LONGNA~1 with the
    // tilde percent-encoded and Chromium reports it bare, so the same document
    // had two hrefs and a Nami running from a Windows short path locked itself
    // out of every window. fileURLToPath decodes once, refuses an encoded
    // separator and anything that is not file:, so this opens the gate no wider:
    // a query string is still refused, because the app never loads with one.
    const fileOf = value => { const url = new URL(value); return url.protocol === 'file:' && !url.search ? fileURLToPath(url) : null; };
    const app = fileOf(appUrl);
    if (!app || fileOf(sender.getURL()) !== app || fileOf(event.senderFrame.url) !== app) return false;
    return [...windows].some(window => !window.isDestroyed() && window.webContents === sender);
  } catch { return false; }
}
function trustedIpc(ipc, allowed) {
  return {
    handle(channel, listener) {
      return ipc.handle(channel, (event, ...args) => {
        if (!allowed(event)) throw Error('This action is only available from Nami.');
        return listener(event, ...args);
      });
    },
    on(channel, listener) {
      return ipc.on(channel, (event, ...args) => { if (allowed(event)) listener(event, ...args); });
    },
  };
}
module.exports = { trustedAppSender, trustedIpc };
