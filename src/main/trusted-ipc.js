// Only registered application windows may call the privileged app bridge.
// Guests and their subframes have their own narrowly checked message channels.
function trustedAppSender(event, windows, appUrl) {
  try {
    const sender = event.sender;
    if (!sender || sender.isDestroyed() || !event.senderFrame || event.senderFrame !== sender.mainFrame) return false;
    const stripHash = value => { const url = new URL(value); url.hash = ''; return url.href; };
    if (stripHash(sender.getURL()) !== appUrl || stripHash(event.senderFrame.url) !== appUrl) return false;
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
