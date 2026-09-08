import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('the browser harness uses authored events without recorded session metadata', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tests/harness-data.js'), 'utf8'), context);
  const json = JSON.stringify(context.window.FIXTURES);
  assert.ok(context.window.FIXTURES.chat.length > 0);
  assert.doesNotMatch(json, /"(?:sessionId|session_id|cwd|password|apiKey|accessToken)"\s*:/);
  assert.doesNotMatch(json, /\/Users\/|\/home\//);
});
test('UUID literals in first-party source and tests are explicitly synthetic', () => {
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'vendor') visit(file); continue; }
      if (!/\.(?:js|mjs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi)) {
        assert.match(match[0], /^00000000-0000-4000-8000-\d{12}$/, `Use a synthetic UUID in ${path.relative(root, file)}`);
      }
    }
  };
  visit(path.join(root, 'src')); visit(path.join(root, 'tests'));
});
