const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { migrateRecents, sortRecents, rememberFolderIn, setPinnedIn, removeFrom } = require('./recents');

const MAX_PANELS_PER_FOLDER = 12;

function folderKey(folder) {
  return folder || '__no_folder__';
}

function homeShort(p, homedir = os.homedir()) {
  return p && p.startsWith(homedir) ? '~' + p.slice(homedir.length) : p;
}

function baseName(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

class WorkspaceStateService {
  constructor({ stateFile, stateDir, debounceMs = 250, fsModule = fs, homedir = os.homedir() } = {}) {
    if (stateFile) {
      this._stateFile = stateFile;
    } else if (stateDir) {
      this._stateFile = path.join(stateDir, 'state.json');
    } else {
      throw new Error('WorkspaceStateService requires stateFile or stateDir');
    }
    this._debounceMs = debounceMs;
    this._fs = fsModule;
    this._homedir = homedir;
    this._saveTimer = null;
    this._state = {
      recentFolders: [],
      currentFolder: null,
      panels: [],
      panelsByFolder: {},
      windows: [],
    };
    this.load();
  }

  getState() {
    return this._state;
  }

  load() {
    try {
      if (this._fs.existsSync(this._stateFile)) {
        const raw = this._fs.readFileSync(this._stateFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          Object.assign(this._state, parsed);
        }
      }
    } catch (_) {
      // Missing or corrupt state file starts clean and will be replaced on save
    }

    if (!this._state.panelsByFolder || typeof this._state.panelsByFolder !== 'object') {
      this._state.panelsByFolder = {};
    }
    if (!Array.isArray(this._state.windows)) {
      this._state.windows = [];
    }

    // pre-multi-window states kept a single desk in `panels`
    if (
      Array.isArray(this._state.panels) &&
      this._state.panels.length &&
      this._state.currentFolder &&
      !this._state.panelsByFolder[this._state.currentFolder]
    ) {
      this._state.panelsByFolder[this._state.currentFolder] = this._state.panels;
    }

    this._state.recentFolders = migrateRecents(this._state.recentFolders);
    return this._state;
  }

  getPanels(folder) {
    const p = this._state.panelsByFolder[folderKey(folder)];
    return Array.isArray(p) ? p.slice(0, MAX_PANELS_PER_FOLDER) : [];
  }

  savePanels(folder, panels) {
    this._state.panelsByFolder[folderKey(folder)] = Array.isArray(panels)
      ? panels.slice(0, MAX_PANELS_PER_FOLDER)
      : [];
    this.persist();
    return { ok: true };
  }

  getCurrentFolder() {
    return this._state.currentFolder;
  }

  setCurrentFolder(folder) {
    this._state.currentFolder = folder;
  }

  getWindows() {
    return this._state.windows;
  }

  setWindows(windows) {
    this._state.windows = Array.isArray(windows) ? windows : [];
  }

  getRecentFolders() {
    return this._state.recentFolders || [];
  }

  rememberFolder(folder, at = Date.now()) {
    this._state.recentFolders = rememberFolderIn(this._state.recentFolders || [], folder, at);
    this._state.currentFolder = folder;
    this.persist();
  }

  pinRecent(folderPath, pinned) {
    this._state.recentFolders = setPinnedIn(this._state.recentFolders || [], folderPath, pinned);
    this.persist();
    return this.getRecentsForRenderer();
  }

  removeRecent(folderPath) {
    this._state.recentFolders = removeFrom(this._state.recentFolders || [], folderPath);
    delete this._state.panelsByFolder[folderKey(folderPath)];
    if (this._state.currentFolder === folderPath) {
      this._state.currentFolder = null;
    }
    this.persist();
    return this.getRecentsForRenderer();
  }

  getRecentsForRenderer() {
    return sortRecents(this._state.recentFolders || []).map((r) => {
      let missing = false;
      try {
        missing = !this._fs.existsSync(r.path);
      } catch (_) {
        missing = true;
      }
      return {
        path: r.path,
        pathShort: homeShort(r.path, this._homedir),
        name: baseName(r.path),
        at: r.at,
        pinned: !!r.pinned,
        missing,
      };
    });
  }

  persist(partial) {
    if (partial && typeof partial === 'object') {
      Object.assign(this._state, partial);
    }
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.flush();
    }, this._debounceMs);
  }

  flush() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    try {
      this._fs.mkdirSync(path.dirname(this._stateFile), { recursive: true });
      const tmp = this._stateFile + '.tmp';
      this._fs.writeFileSync(tmp, JSON.stringify(this._state, null, 2));
      this._fs.renameSync(tmp, this._stateFile);
    } catch (_) {}
  }
}

module.exports = {
  WorkspaceStateService,
  folderKey,
  homeShort,
  baseName,
  MAX_PANELS_PER_FOLDER,
};

