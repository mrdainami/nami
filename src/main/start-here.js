// The note Nami leaves in a folder it made for you.
//
// Obsidian's new vault arrives with a welcome note, and it is the cheapest
// documentation a folder-scoped app can ship: the guide is the first thing in
// the file tree, it opens in Nami's own viewer, and the newcomer's first ask can
// be about the file they are already looking at. No tour engine, no new surface,
// and the note demonstrates folder-scoping by being an example of it.
//
// Pure on purpose — no electron import — so `node --test` can read the text and
// check the writer against a temp dir. main.js does nothing but call it.

const fsp = require('node:fs/promises');
const path = require('node:path');

// Sorts high in a file tree and reads as an instruction rather than a filename.
// The test pins it: a drift to "welcome.md" would bury it under the user's own
// folders and quietly undo the whole point.
const NOTE_NAME = 'Start here.md';

// Written for somebody who has never run an agent. Five sections, in the order
// they will hit them, and every heading is a sentence rather than a noun — this
// is a note, not a manual. The example asks are deliberately not about code.
function startHereNote(folderName) {
  const name = folderName || 'this folder';
  return `# Start here

This is **${name}** — the folder you just gave Nami.

Nami can read and change things in here, and nowhere else on your Mac. That is
the whole safety model, and it is why every session asks you for a folder first.

## Nami runs agents. It isn't one.

Nami is the desk. The thinking is done by an agent — Claude Code, Codex and a
few others — signed in with **your own account**. No Nami account, no second
bill. If you have none installed yet, press **New session** and pick one from
the list; it installs from there.

## Ask in plain English

There are no commands to learn. Open a session and say what you need. Twelve
things people actually ask for:

**Make sense of a pile**

- Read every PDF in here and build me one spreadsheet: date, client, amount.
- Go through these receipts and tell me what I spent, by month.
- Summarise all the feedback in this folder into the top five complaints.

**Tidy up**

- Rename these files to "date — client — what it is", based on what's inside.
- Sort this folder into subfolders by year and type.
- Find every place my old company name appears in here and change it.

**Write it for me**

- Turn my messy notes into a clean one-page brief I can send a client.
- Draft a follow-up email to everyone in contacts.csv who hasn't replied.
- Take this meeting transcript and pull out every decision and who owns it.

**Look into it**

- Compare our prices in pricing.csv with the top twenty competitors.
- Read this contract and flag anything unusual against the others in here.
- Build me a simple one-page site from this, and open it so I can see it.

Drop some files in here and try one.

## It stops and asks before it changes anything

Reading is free. Anything that *changes* something — writing a file, running a
command, going online — pauses and shows you a **Needs your OK** card naming
exactly what it wants to do.

**Go ahead** lets that one thing through. **Not now** stops it and the agent
carries on without it. Nothing happens behind your back.

## Run more than one at a time

Every job gets its own pane. Start a second with **⌘N** while the first is still
working, and watch both. That is the point of the desk.

---

You can delete this file whenever you like — it is yours now. Nami will not put
it back.
`;
}

// Writes the note only if nothing of that name is there. `wx` is the whole
// guarantee: it fails rather than truncates, so a folder that already has a
// Start here.md — the user's own, or one from a previous run — is never
// clobbered. Any failure is a false, not a throw; a missing welcome note must
// never be the reason creating a folder appears to break.
async function seedStartHere(dir) {
  try {
    await fsp.writeFile(path.join(dir, NOTE_NAME), startHereNote(path.basename(dir)), {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { NOTE_NAME, startHereNote, seedStartHere };
