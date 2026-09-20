// Reads the three facts about a Windows binary that decide whether it can be
// shipped: which processor it was built for, whether it is one of the hybrids
// an ARM PC keeps in System32, and which DLLs it will ask Windows for.
//
// It exists because a wrong-arch DLL is invisible until it fails. The file name
// is the same on every arch, the installer builds, the app starts, and the
// first dictation says "The specified module could not be found" on a machine
// nobody on the team owns. The header is the only place the truth is written,
// so the staging script and check-bundle both read it rather than trusting the
// folder a file was found in.
//
// Pure: a Buffer in, plain data out. That is what lets a Mac test it.

export const MACHINE = { x64: 0x8664, arm64: 0xaa64 };

const IMPORT_TABLE = 1, LOAD_CONFIG = 10, DELAY_IMPORT = 13;
// Where IMAGE_LOAD_CONFIG_DIRECTORY64 keeps CHPEMetadataPointer.
const CHPE_OFFSET = 0xc8;

export function readPe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x40 || buf.toString('latin1', 0, 2) !== 'MZ') throw new Error('not a Windows binary');
  const pe = buf.readUInt32LE(0x3c);
  if (pe + 24 > buf.length || buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a Windows binary');
  const machine = buf.readUInt16LE(pe + 4);
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const plus = buf.readUInt16LE(optional) === 0x20b;   // PE32+, which every 64-bit image is
  const directories = optional + (plus ? 112 : 96);
  const sectionTable = optional + buf.readUInt16LE(pe + 20);

  const sections = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = sectionTable + i * 40;
    if (s + 40 > buf.length) break;
    sections.push({ size: Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16)), rva: buf.readUInt32LE(s + 12), raw: buf.readUInt32LE(s + 20) });
  }
  // Everything inside a PE is addressed as it will sit in memory, not as it
  // sits in the file, so every pointer has to be walked back through a section.
  const at = (rva) => {
    const s = sections.find((x) => rva >= x.rva && rva < x.rva + x.size);
    return s ? rva - s.rva + s.raw : -1;
  };
  const directory = (i) => (directories + i * 8 + 8 <= buf.length ? buf.readUInt32LE(directories + i * 8) : 0);
  const text = (offset) => {
    if (offset < 0 || offset >= buf.length) return '';
    let end = offset;
    while (end < buf.length && buf[end]) end++;
    return buf.toString('latin1', offset, end);
  };
  // Both import tables are arrays of fixed-size records ending in an empty one.
  const names = (index, size, nameField) => {
    const out = [];
    let o = directory(index) ? at(directory(index)) : -1;
    for (; o >= 0 && o + size <= buf.length; o += size) {
      const name = buf.readUInt32LE(o + nameField);
      if (!name) break;
      out.push(text(at(name)));
    }
    return out.filter(Boolean);
  };

  // An ARM PC's System32 is shared by ARM64 and emulated x64 programs, so the
  // DLLs in it are hybrids and the machine field alone does not describe them.
  // Measured on Windows 11 ARM64 with the VC++ 2015-2022 redistributable:
  //   vcruntime140.dll    0xAA64 + hybrid metadata   ARM64X, serves both
  //   vcruntime140_1.dll  0x8664 + hybrid metadata   ARM64EC, x64 in name only
  // The second kind is the trap. It says x64 and it is ARM code inside; on an
  // Intel PC it cannot run. A non-zero CHPEMetadataPointer is what marks both.
  let hybrid = false;
  const config = plus && directory(LOAD_CONFIG) ? at(directory(LOAD_CONFIG)) : -1;
  if (config >= 0 && config + CHPE_OFFSET + 8 <= buf.length && buf.readUInt32LE(config) >= CHPE_OFFSET + 8) {
    hybrid = buf.readBigUInt64LE(config + CHPE_OFFSET) !== 0n;
  }

  return { machine, hybrid, imports: names(IMPORT_TABLE, 20, 12), delayImports: names(DELAY_IMPORT, 32, 4) };
}

// What is wrong with shipping this binary to a PC of this arch, or null.
//
// ARM64X passes for arm64: it is what Microsoft's own arm64 redistributable
// installs, and an ARM64 process loads it as ordinary ARM64. A hybrid never
// passes for x64, whatever its machine field says.
export function archProblem(info, arch) {
  const want = MACHINE[arch];
  if (!want) return `unknown arch ${arch}`;
  const hex = '0x' + info.machine.toString(16).toUpperCase();
  if (info.machine !== want) return `built for ${archName(info.machine) || hex}, not ${arch}`;
  if (arch === 'x64' && info.hybrid) return 'an ARM64EC hybrid from an ARM PC, which an Intel or AMD PC cannot run';
  return null;
}

export function archName(machine) {
  return Object.keys(MACHINE).find((k) => MACHINE[k] === machine) || null;
}
