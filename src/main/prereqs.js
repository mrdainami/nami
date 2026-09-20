// "Is what this install needs on the machine?"
//
// A Mac comes with git, and the people Nami was built for already had Node. A
// PC comes with neither. Without this, the first thing a new Windows user sees
// from "Install it for me" is PowerShell saying the term 'npm' is not
// recognized as the name of a cmdlet — true, and no help at all. So the
// question is asked before the command runs, and the answer names the one
// command that fixes it.
//
// Only on Windows. A Mac says nothing today and keeps saying nothing: the rule
// on this branch is that the Mac does not change.
//
// Pure: the caller finds the programs (findOnDisk, against the same PATH the
// tile will run with) and hands in what it found.

// One thing to install can put more than one program on the PATH: npm arrives
// with Node, so a missing npm is a Node install, said once.
const INSTALLS = [
  { name: 'Git', bins: ['git'], win: 'winget install --id Git.Git -e' },
  { name: 'Node.js', bins: ['node', 'npm'], win: 'winget install --id OpenJS.NodeJS.LTS -e' },
];

const NEEDS = { git: ['git'], npm: ['node', 'npm'], npx: ['node', 'npm'], node: ['node'] };

// What a command line (or a list of steps) will start. Read off the first word
// of each step, with any .cmd/.exe taken off — `npm.cmd install` needs what
// `npm install` needs. A piped installer (`irm … | iex`) brings its own.
function needsOf(command) {
  const steps = Array.isArray(command) ? command : [command];
  const out = new Set();
  for (const step of steps) {
    const head = String(step || '').trim().split(/\s+/)[0].toLowerCase().replace(/\.(cmd|exe)$/, '');
    for (const bin of NEEDS[head] || []) out.add(bin);
  }
  return ['git', 'node', 'npm'].filter((b) => out.has(b));
}

// needs: from needsOf. found: { git: 'C:\\…\\git.exe', node: '', … } — a path,
// or empty when it is not there. Returns null when there is nothing to say.
function missingPrereqs({ needs = [], found = {}, platform = process.platform } = {}) {
  if (platform !== 'win32') return null;
  const missing = needs.filter((b) => !found[b]);
  if (!missing.length) return null;
  const installs = INSTALLS.filter((i) => i.bins.some((b) => missing.includes(b)));
  const names = installs.map((i) => i.name).join(' and ');
  const many = installs.length > 1;
  // `short` is for a toast, `message` for a sheet with the commands under it.
  return {
    missing,
    short: `${names} ${many ? 'are' : 'is'} not on this PC yet.`,
    message: `${names} ${many ? 'are' : 'is'} not on this PC yet, and this install needs ${many ? 'them' : 'it'}. `
      + `Run ${many ? 'these' : 'this'} in a terminal first, then come back:`,
    commands: installs.map((i) => i.win),
  };
}

module.exports = { needsOf, missingPrereqs };
