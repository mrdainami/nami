// Which buttons the Grok sheet shows, given what status reported.
//
// Grok itself prefers a session token in ~/.grok/auth.json over XAI_API_KEY.
// `via` is that same choice: 'account' | 'api_key' | null. Saving a key while
// an account is active therefore has to log the account out, or the key is
// stored and still unused.

export const GROK_API_KEY = 'XAI_API_KEY';

export function grokAuthActions(st) {
  const via = st && st.signedIn === true ? st.via : null;
  const hasApiKey = !!(st && st.hasApiKey);
  const onAccount = via === 'account';
  const onKey = via === 'api_key';
  return {
    signInAccount: !onAccount,
    signOutAccount: onAccount,
    switchToKey: onAccount && hasApiKey,
    pasteKey: !onAccount || !hasApiKey,
    pasteLabel: onKey ? 'Replace API key' : 'Use an API key',
    logoutAfterSave: onAccount,
  };
}
