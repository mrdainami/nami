// The application menu: six menus, written out by hand, none of them Electron's.
//
// Nami shipped with Electron's stock menu, which is why the Nami menu offered
// Services, Hide Others and Show All, why Edit offered smart quotes to an app
// whose text is prompts and paths, and why About Nami opened the grey macOS
// panel that credited a person instead of the company. Nothing the app can
// actually do appeared up there: ⌘N, ⌘O, ⌘K, ⌘, and ⌘S all worked with no menu
// to say so, and a Mac user reads the menu bar to find out what an app can do.
//
// The catch, and the reason this file has tests: building a template replaces
// the default menu wholesale. Electron's default is not a starting point you
// extend, it is a thing you lose. Omit the Edit roles and ⌘C stops working
// everywhere, including inside the terminal; omit quit and ⌘Q goes with it. So
// every role that carries a key is restated here, and `menuRoles` walks the
// whole tree so a test can assert they are all still present rather than
// trusting the reading.
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

// Every command a menu item can send, by its base name. A command is a string
// that has to match a string in app.js, so a typo is a dead menu item that
// throws nothing at all. Declaring the set lets a test catch that instead of a
// user finding it.
//
// Anything after a colon is an argument: settings:keys, rail:workspace,
// theme:graphite, open-recent:/Users/x/nami.
const COMMANDS = [
  'about', 'update-check', 'settings',
  'new-session', 'open-folder', 'open-recent', 'new-file', 'new-folder',
  'save', 'reveal', 'close-pane',
  'dictate',
  'rail', 'theme', 'agents',
];

const THEMES = [['paper', 'Paper'], ['operator', 'Operator'], ['glass', 'Glass'], ['graphite', 'Graphite']];

const SEP = { type: 'separator' };

// The last path segment, which is what the folder is called. Recents rows are
// absolute paths and the menu has room for a name, not a path.
function folderName(p) {
  const parts = String(p || '').split('/').filter(Boolean);
  return parts[parts.length - 1] || p;
}

// `platform` is a parameter for the same reason it is one in platform.js: a
// test cannot pretend to be Windows any other way. `theme` and `recents` are
// parameters because the menu has to be rebuilt when either changes, and a
// builder that read them itself could not be checked without a running app.
function buildMenuTemplate({
  open, send, newWindow, platform = process.platform, name = 'Nami', theme = 'paper', recents = [],
} = {}) {
  const mac = platform === 'darwin';
  const cmd = (label, command, extra = {}) => ({ label, ...extra, click: () => send(command) });
  const link = (label, url) => ({ label, click: () => open(url) });

  // Two of these are the whole reason the branch exists. About Nami carries no
  // role, because `role: 'about'` is the stock panel; it opens Nami's own About
  // pane instead, which already knows the version, the day this copy landed,
  // whether a newer one exists and the licence. Settings takes the slot
  // Services used to hold, and ⌘, already did this with no menu to say so.
  const appSubmenu = [
    cmd('About Nami', 'about'),
    cmd('Check for Updates', 'update-check'),
    SEP,
    cmd('Settings', 'settings', { accelerator: 'CommandOrControl+,' }),
    SEP,
    { role: 'hide' },
    SEP,
    { role: 'quit' },
  ];

  // File is new. It is also where ⌘W lives, and the reason this file has a test
  // shouting about it: the conventional Mac File menu holds `role: 'close'`,
  // which binds ⌘W to Close Window, and Nami binds ⌘W to close the active
  // *pane*. A menu accelerator outranks a renderer keydown, so the
  // conventional item would silently turn "close this tile" into "close the
  // window and lose every session in it". Close Pane is routed to the same
  // handler the keydown ran, so the key keeps its meaning and gains a label.
  const fileSubmenu = [
    cmd('New Session', 'new-session', { accelerator: 'CommandOrControl+N' }),
    { label: 'New Window', accelerator: 'Shift+CommandOrControl+N', click: () => newWindow() },
    SEP,
    cmd('Open Folder', 'open-folder', { accelerator: 'CommandOrControl+O' }),
    // Disabled rather than absent when there is nothing in it: a menu item that
    // comes and goes is one a person stops trusting is there.
    {
      label: 'Open Recent',
      enabled: recents.length > 0,
      submenu: recents.map((r) => cmd(folderName(r.path), `open-recent:${r.path}`)),
    },
    SEP,
    cmd('New File', 'new-file'),
    cmd('New Folder', 'new-folder'),
    SEP,
    cmd('Save', 'save', { accelerator: 'CommandOrControl+S' }),
    cmd('Reveal in Finder', 'reveal'),
    SEP,
    cmd('Close Pane', 'close-pane', { accelerator: 'CommandOrControl+W' }),
    // Off macOS there is no app submenu, so File is the only place these can go.
    ...(mac ? [] : [SEP, cmd('Settings', 'settings', { accelerator: 'CommandOrControl+,' }), { role: 'quit' }]),
  ];

  // Every role here has to stay. Substitutions and Speech do not: they are
  // macOS text features, offered free with `role: 'editMenu'`, and neither has
  // anything to say to an app whose text is prompts, code and paths.
  const editSubmenu = [
    { role: 'undo' },
    { role: 'redo' },
    SEP,
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'pasteAndMatchStyle' },
    { role: 'delete' },
    { role: 'selectAll' },
    SEP,
    cmd('Dictate into This Session', 'dictate'),
    cmd('Voice Settings', 'settings:voice'),
  ];

  // "Toggle Sidebar" and not the Mac-conventional "Hide Sidebar", because the
  // conventional label swaps to "Show Sidebar" when the sidebar is hidden, and
  // whether it is hidden is renderer state. A label that is wrong half the time
  // is worse than one that is plain.
  //
  // Reload and Developer Tools move to the bottom, in a submenu. They were the
  // first two items in Electron's View menu, which put ⌘R one keystroke from
  // wiping the desk you are working on.
  const viewSubmenu = [
    cmd('Sessions', 'rail:sessions', { accelerator: 'CommandOrControl+1' }),
    cmd('Workspace', 'rail:workspace', { accelerator: 'CommandOrControl+2' }),
    cmd('Library', 'rail:library', { accelerator: 'CommandOrControl+3' }),
    SEP,
    cmd('Toggle Sidebar', 'rail:toggle', { accelerator: 'CommandOrControl+Alt+S' }),
    SEP,
    {
      label: 'Theme',
      submenu: THEMES.map(([id, label]) => cmd(label, `theme:${id}`, { type: 'radio', checked: theme === id })),
    },
    SEP,
    cmd('Agents', 'agents', { accelerator: 'CommandOrControl+K' }),
    SEP,
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    SEP,
    { role: 'togglefullscreen' },
    SEP,
    { label: 'Developer', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }] },
  ];

  // role: 'window' rather than a plain label, because that is what tells macOS
  // to append the list of open windows underneath. Nami is a window per project
  // space, so that list is how you get between two folders.
  const windowSubmenu = [
    { role: 'minimize' },
    { role: 'zoom' },
    SEP,
    { role: 'front' },
  ];

  // Docs first: it is the answer to the question that brings anyone here, and
  // the site has had a docs page for a while with nothing in the app pointing
  // at it. Keyboard Shortcuts stays inside the app, because the answer is
  // already in Settings.
  //
  // ★ Star Nami lives here and not in the Nami menu on purpose. The Nami menu
  // is opened with intent, for Settings or Quit, and an ask parked there taxes
  // every one of those visits. Help is where a Mac user looks for the project
  // itself, and About Nami already reaches the star in one hop: the pane it
  // opens has the star button as its primary action.
  const helpSubmenu = [
    link('Nami Docs', LINKS.docs),
    cmd('Keyboard Shortcuts', 'settings:keys'),
    SEP,
    link('Nami on GitHub', LINKS.repo),
    link('★ Star Nami', LINKS.repo),
    link('Report an Issue', LINKS.issue),
    link('Release Notes', LINKS.releases),
    SEP,
    link('Nami for Your Team', LINKS.teams),
    link('Made by Cal', LINKS.maker),
    SEP,
    link('Terms', LINKS.terms),
    ...(mac ? [] : [SEP, cmd('About Nami', 'about'), cmd('Check for Updates', 'update-check')]),
  ];

  return [
    ...(mac ? [{ label: name, submenu: appSubmenu }] : []),
    { label: 'File', submenu: fileSubmenu },
    { label: 'Edit', submenu: editSubmenu },
    { label: 'View', submenu: viewSubmenu },
    { label: 'Window', role: 'window', submenu: windowSubmenu },
    { label: 'Help', role: 'help', submenu: helpSubmenu },
  ];
}

// Every item in the tree, at any depth. Submenus are three deep now (Theme,
// Developer, Open Recent), so anything that checks the menu has to recurse or
// it silently checks two thirds of it.
function menuItems(template) {
  const out = [];
  const walk = (items) => {
    for (const item of items || []) {
      out.push(item);
      if (item.submenu) walk(item.submenu);
    }
  };
  walk(template);
  return out;
}

// Flattened role names, for the test that guards against losing ⌘C or ⌘Q to a
// future edit of the template above.
function menuRoles(template) {
  return menuItems(template).map((i) => i.role).filter(Boolean);
}

// The only part that touches Electron.
function installAppMenu({ Menu, shell, app: electronApp, send, newWindow, theme, recents }) {
  const template = buildMenuTemplate({
    open: (url) => shell.openExternal(url),
    send,
    newWindow,
    name: (electronApp && electronApp.name) || 'Nami',
    theme,
    recents,
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenuTemplate, menuItems, menuRoles, installAppMenu, LINKS, COMMANDS, REPO };
