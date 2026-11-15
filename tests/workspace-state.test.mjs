import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WorkspaceStateService, folderKey, homeShort, baseName } from '../src/main/workspace-state.js';

test('folderKey handles null, undefined, empty string and normal folders', () => {
  assert.equal(folderKey(null), '__no_folder__');
  assert.equal(folderKey(undefined), '__no_folder__');
  assert.equal(folderKey(''), '__no_folder__');
  assert.equal(folderKey('/path/to/folder'), '/path/to/folder');
});

test('homeShort abbreviates home directory with tilde', () => {
  const fakeHome = process.platform === 'win32' ? 'C:\\Users\\alice' : '/Users/alice';
  const child = process.platform === 'win32' ? 'C:\\Users\\alice\\project' : '/Users/alice/project';
  assert.equal(homeShort(child, fakeHome), '~' + (process.platform === 'win32' ? '\\project' : '/project'));
  assert.equal(homeShort('/opt/other', fakeHome), '/opt/other');
});

test('baseName extracts last path segment across slashes', () => {
  assert.equal(baseName('C:\\Users\\alice\\project'), 'project');
  assert.equal(baseName('/home/alice/project/'), 'project');
  assert.equal(baseName(''), '');
});

test('WorkspaceStateService initializes with defaults when state file is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-'));
  try {
    const service = new WorkspaceStateService({ stateDir: tmpDir });
    assert.deepEqual(service.getPanels(null), []);
    assert.deepEqual(service.getRecentFolders(), []);
    assert.equal(service.getCurrentFolder(), null);
    assert.deepEqual(service.getWindows(), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService recovers gracefully from corrupt JSON state file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-corrupt-'));
  const stateFile = path.join(tmpDir, 'state.json');
  fs.writeFileSync(stateFile, '{ corrupt json invalid syntax ...');
  try {
    const service = new WorkspaceStateService({ stateFile });
    assert.deepEqual(service.getPanels(null), []);
    assert.deepEqual(service.getRecentFolders(), []);
    assert.equal(service.getCurrentFolder(), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService migrates legacy pre-multi-window state.panels to panelsByFolder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-migrate-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const legacyData = {
    currentFolder: '/Users/alice/legacy-proj',
    panels: [{ id: 'p1', kind: 'claude' }],
    recentFolders: ['/Users/alice/legacy-proj'],
  };
  fs.writeFileSync(stateFile, JSON.stringify(legacyData));
  try {
    const service = new WorkspaceStateService({ stateFile });
    const panels = service.getPanels('/Users/alice/legacy-proj');
    assert.equal(panels.length, 1);
    assert.equal(panels[0].id, 'p1');
    assert.deepEqual(service.getWindows(), []);
    assert.equal(service.getRecentFolders()[0].path, '/Users/alice/legacy-proj');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService saves and caps panels at 12 per folder', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-panels-'));
  try {
    const service = new WorkspaceStateService({ stateDir: tmpDir, debounceMs: 0 });
    const fifteenPanels = Array.from({ length: 15 }, (_, i) => ({ id: `panel-${i}` }));
    service.savePanels('/Users/alice/repo', fifteenPanels);
    
    // Check in-memory
    const saved = service.getPanels('/Users/alice/repo');
    assert.equal(saved.length, 12);
    assert.equal(saved[0].id, 'panel-0');
    assert.equal(saved[11].id, 'panel-11');

    // Flush and verify on disk
    service.flush();
    const diskContent = JSON.parse(fs.readFileSync(path.join(tmpDir, 'state.json'), 'utf8'));
    assert.equal(diskContent.panelsByFolder['/Users/alice/repo'].length, 12);

    // Check null/empty folder
    service.savePanels(null, [{ id: 'p-empty' }]);
    service.flush();
    assert.equal(service.getPanels(null)[0].id, 'p-empty');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService recents: rememberFolder, pinRecent, removeRecent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-recents-'));
  const existingFolder = path.join(tmpDir, 'my-folder');
  fs.mkdirSync(existingFolder);

  try {
    const service = new WorkspaceStateService({ stateDir: tmpDir });
    service.rememberFolder(existingFolder, 1000);
    assert.equal(service.getCurrentFolder(), existingFolder);

    // Also attach some panels to this folder
    service.savePanels(existingFolder, [{ id: 'tile1' }]);
    assert.equal(service.getPanels(existingFolder).length, 1);

    const recentsRows = service.getRecentsForRenderer();
    assert.equal(recentsRows.length, 1);
    assert.equal(recentsRows[0].path, existingFolder);
    assert.equal(recentsRows[0].missing, false);
    assert.equal(recentsRows[0].pinned, false);

    // Pin
    const afterPin = service.pinRecent(existingFolder, true);
    assert.equal(afterPin[0].pinned, true);

    // Remove
    const afterRemove = service.removeRecent(existingFolder);
    assert.equal(afterRemove.length, 0);
    assert.equal(service.getCurrentFolder(), null);
    assert.deepEqual(service.getPanels(existingFolder), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService flush uses atomic write via .tmp file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-atomic-'));
  const stateFile = path.join(tmpDir, 'state.json');
  try {
    const service = new WorkspaceStateService({ stateFile });
    service.setCurrentFolder('/test');
    service.flush();

    assert.ok(fs.existsSync(stateFile));
    assert.ok(!fs.existsSync(stateFile + '.tmp'));

    const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(parsed.currentFolder, '/test');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WorkspaceStateService debounces concurrent persist calls without data race', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nami-test-state-concurrent-'));
  const stateFile = path.join(tmpDir, 'state.json');
  try {
    const service = new WorkspaceStateService({ stateFile, debounceMs: 50 });
    
    // Rapid concurrent writes
    for (let i = 0; i < 20; i++) {
      service.savePanels(`/folder-${i}`, [{ id: `p-${i}` }]);
    }
    
    // Wait for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.ok(fs.existsSync(stateFile));
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (let i = 0; i < 20; i++) {
      assert.equal(saved.panelsByFolder[`/folder-${i}`][0].id, `p-${i}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

