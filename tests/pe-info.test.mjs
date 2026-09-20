import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPe, archProblem, archName } from '../scripts/pe-info.mjs';
import { makePe, X64, ARM64 } from './pe-fixture.mjs';

test('the machine, the hybrid mark and both import tables are read from the header', () => {
  const pe = readPe(makePe({ machine: X64, imports: ['KERNEL32.dll', 'VCRUNTIME140_1.dll'], delayImports: ['DirectML.dll'] }));
  assert.equal(pe.machine, 0x8664);
  assert.equal(pe.hybrid, false);
  assert.deepEqual(pe.imports, ['KERNEL32.dll', 'VCRUNTIME140_1.dll']);
  assert.deepEqual(pe.delayImports, ['DirectML.dll']);
  assert.equal(archName(pe.machine), 'x64');
  assert.equal(archName(0x14c), null);
});

test('a binary with no imports at all is still a binary', () => {
  const pe = readPe(makePe({ machine: ARM64 }));
  assert.deepEqual(pe.imports, []);
  assert.deepEqual(pe.delayImports, []);
});

test('a plain binary is accepted for its own arch and refused for the other', () => {
  assert.equal(archProblem(readPe(makePe({ machine: ARM64 })), 'arm64'), null);
  assert.equal(archProblem(readPe(makePe({ machine: X64 })), 'x64'), null);
  assert.match(archProblem(readPe(makePe({ machine: X64 })), 'arm64'), /built for x64, not arm64/);
  assert.match(archProblem(readPe(makePe({ machine: ARM64 })), 'x64'), /built for arm64, not x64/);
  assert.match(archProblem(readPe(makePe({ machine: 0x14c })), 'x64'), /built for 0x14C, not x64/);
  assert.match(archProblem(readPe(makePe()), 'ia32'), /unknown arch/);
});

// Both measured in System32 on Windows 11 ARM64: vcruntime140.dll is the
// first kind, vcruntime140_1.dll the second.
test('an ARM PC\'s hybrids: ARM64X ships as arm64, ARM64EC never ships as x64', () => {
  const arm64x = readPe(makePe({ machine: ARM64, hybrid: true }));
  assert.equal(arm64x.hybrid, true);
  assert.equal(archProblem(arm64x, 'arm64'), null);
  assert.match(archProblem(arm64x, 'x64'), /built for arm64/);

  const arm64ec = readPe(makePe({ machine: X64, hybrid: true }));
  assert.equal(arm64ec.machine, 0x8664);
  assert.match(archProblem(arm64ec, 'x64'), /ARM64EC/);
  assert.match(archProblem(arm64ec, 'arm64'), /built for x64/);
});

test('a Mac or Linux library, a text file and a truncated file are all refused by name', () => {
  const macho = Buffer.alloc(256); macho.writeUInt32LE(0xfeedfacf, 0);
  const elf = Buffer.concat([Buffer.from('\x7fELF', 'latin1'), Buffer.alloc(252)]);
  for (const bytes of [macho, elf, Buffer.from('not a dll'), Buffer.alloc(0), makePe().subarray(0, 0x84), 'a string']) {
    assert.throws(() => readPe(bytes), /not a Windows binary/);
  }
});
