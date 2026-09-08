const fs = require('fs');
const os = require('os');
const path = require('path');

// Select before Electron initializes storage. Never reuse a review directory,
// and never claim ownership of a directory supplied by the caller.
function createReviewProfile({ argv, normalPath, packaged }) {
  const review = argv.some((arg) => arg === '--demo' || arg === '--screenshot'
    || arg.startsWith('--scene=') || arg.startsWith('--theme='));
  const index = argv.indexOf('--user-data');
  const explicit = index >= 0 && argv[index + 1];
  const owned = review && !explicit;
  const directory = explicit ? path.resolve(explicit)
    : owned ? fs.mkdtempSync(path.join(os.tmpdir(), 'nami-review-'))
      : normalPath + (packaged ? '' : '-dev');
  return {
    review,
    path: directory,
    cleanup() {
      if (owned) fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

module.exports = { createReviewProfile };
