import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

const read = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const production = yaml.load(read('electron-builder.yml'));
const review = yaml.load(read('electron-builder.review.yml'));
const pkg = JSON.parse(read('package.json'));

test('review app and helpers cannot share the installed app permission identity', () => {
  assert.equal(production.appId, 'ai.dainami.nami');
  assert.equal(review.extends, './electron-builder.yml');
  assert.equal(review.appId, 'ai.dainami.nami.review');
  assert.notEqual(review.appId, production.appId);
  for (const suffix of ['', '.EH', '.NP', '.Renderer', '.GPU', '.Plugin']) {
    const productionHelper = (production.mac?.helperBundleId || production.appId + '.helper') + suffix;
    const reviewHelper = (review.mac?.helperBundleId || review.appId + '.helper') + suffix;
    assert.notEqual(reviewHelper, productionHelper, 'Electron helpers need their own review identity too');
  }
  assert.notEqual(review.productName, production.productName, 'Finder must distinguish the two apps');
  assert.notEqual(review.extraMetadata?.name, pkg.name, 'Electron default userData names must differ');
  assert.ok(review.extraMetadata?.name, 'review package needs an explicit runtime identity');
  assert.notEqual(review.directories?.output, production.directories?.output, 'review packaging must not overwrite release artifacts');
});

test('review packaging explicitly selects the isolated config and cannot publish', () => {
  const command = pkg.scripts['pack:review'];
  assert.match(command, /(?:^|\s)--config\s+electron-builder\.review\.yml(?:\s|$)/);
  assert.match(command, /(?:^|\s)--dir(?:\s|$)/);
  assert.match(command, /(?:^|\s)--publish\s+never(?:\s|$)/);
  assert.equal(review.mac.identity, null, 'local review must not inherit production signing selection');
  assert.equal(review.dmg.sign, false);
});
