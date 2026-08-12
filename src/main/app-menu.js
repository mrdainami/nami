// The application menu, and in particular a Help menu that says something.
//
// Nami shipped with Electron's stock menu, which means Help contained a search
// box and nothing else. That is the first place a Mac user looks for "where is
// the website" and "how do I report this", and it led nowhere — while the app
// itself had no link to its own repo outside the About pane.
//
// The catch, and the reason this file has tests: building a template replaces
// the default menu wholesale. Electron's default is not a starting point you
// extend, it is a thing you lose. Omit the Edit submenu and ⌘C stops working
// everywhere, including inside the terminal; omit the app submenu and ⌘Q does
// too. So every standard role is restated here, and `menuRoles` exists so a
// test can assert they are all still present rather than trusting the reading.
//
// Split the way platform.js is: a pure builder that returns a plain template
// (no electron import, so `node --test` can check it), and one thin function
// that hands the result to Electron.

const REPO = 'https://github.com/mrdainami/nami';
const SITE = 'https://nami.dainami.ai';

// Where the app sends people, and how those visits are told apart later.
//
// Nami has no telemetry and is not getting any — "nothing leaves your Mac" is
// one of three reasons people trust it. UTMs are the whole measurement story
// instead: they cost nothing, they are visible to anyone who looks at the link,
// and they are read by analytics that already exist on the other end. The
// medium names the surface so "did the Help menu ever get used" has an answer.
//
// docs and terms are the site's own pages, so they get the same treatment as
// dainami.ai. releases stays bare with the other GitHub links.
const LINKS = {
  repo: REPO,
  issue: `${REPO}/issues/new`,
  releases: `${REPO}/releases`,
  docs: `${SITE}/docs?utm_source=nami-app&utm_medium=help-menu`,
  terms: `${SITE}/terms?utm_source=nami-app&utm_medium=help-menu`,
  teams: 'https://dainami.ai/?utm_source=nami-app&utm_medium=help-menu&utm_campaign=teams',
  maker: 'https://dainami.ai/links?utm_source=nami-app&utm_medium=help-menu',
};

// "Made by Cal" rather than "Calvin's links". Both point at the same page; the
// first reads as a credit, so following it is curiosity. The second announces
// itself as a funnel, which is the fastest way to make a work tool feel like
// one.
function helpSubmenu(open) {
  return [
    { label: 'Nami on GitHub', click: () => open(LINKS.repo) },
    { label: '★ Star Nami', click: () => open(LINKS.repo) },
    { label: 'Report an issue', click: () => open(LINKS.issue) },
    { type: 'separator' },
    { label: 'Nami for your team…', click: () => open(LINKS.teams) },
    { label: 'Made by Cal', click: () => open(LINKS.maker) },
  ];
}

// `platform` is a parameter for the same reason it is one in platform.js: a
// test cannot pretend to be Windows any other way.
//
// There is deliberately no File menu on macOS, and the reason is ⌘W. The
// obvious template puts `role: 'close'` there, which is the Mac convention and
// which binds ⌘W to Close Window — but Nami already binds ⌘W to *close pane*
// (app.js, onGlobalKey), and a menu accelerator outranks a renderer keydown.
// Adding the conventional item would have quietly turned "close this tile" into
// "close the whole window", losing every other session in it. The app submenu
// already carries ⌘Q, so File has nothing left it needs to say here.
//
// Off macOS there is no app submenu, so File exists purely to hold quit.
function buildMenuTemplate({ open, platform = process.platform, name = 'Nami' } = {}) {
  const mac = platform === 'darwin';
  return [
    ...(mac ? [{ role: 'appMenu', label: name }] : []),
    ...(mac ? [] : [{ label: 'File', submenu: [{ role: 'quit' }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: helpSubmenu(open) },
  ];
}

// Flattened role names, for the test that guards against losing ⌘C or ⌘Q to a
// future edit of the template above.
function menuRoles(template) {
  const out = [];
  for (const item of template) {
    if (item.role) out.push(item.role);
    for (const sub of item.submenu || []) if (sub.role) out.push(sub.role);
  }
  return out;
}

// The only part that touches Electron.
function installAppMenu({ Menu, shell, app: electronApp }) {
  const template = buildMenuTemplate({
    open: (url) => shell.openExternal(url),
    name: (electronApp && electronApp.name) || 'Nami',
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenuTemplate, menuRoles, installAppMenu, LINKS, REPO };
