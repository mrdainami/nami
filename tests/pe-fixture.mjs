// The smallest file Windows would still call a binary, built to order so a Mac
// can test what the build scripts make of real ones. One section holds the
// import table, the delay-import table and the load config, which are the only
// parts scripts/pe-info.mjs reads.
export const X64 = 0x8664, ARM64 = 0xaa64;

export function makePe({ machine = ARM64, hybrid = false, imports = [], delayImports = [] } = {}) {
  const RVA = 0x1000, RAW = 0x400, SIZE = 0x800;
  const buf = Buffer.alloc(RAW + SIZE);
  buf.write('MZ', 0, 'latin1');
  const pe = 0x80;
  buf.writeUInt32LE(pe, 0x3c);
  buf.write('PE\0\0', pe, 'latin1');
  buf.writeUInt16LE(machine, pe + 4);
  buf.writeUInt16LE(1, pe + 6);             // one section
  buf.writeUInt16LE(240, pe + 20);          // size of a PE32+ optional header
  const optional = pe + 24;
  buf.writeUInt16LE(0x20b, optional);       // PE32+
  const directories = optional + 112;
  const section = optional + 240;
  buf.write('.rdata', section, 'latin1');
  buf.writeUInt32LE(SIZE, section + 8);
  buf.writeUInt32LE(RVA, section + 12);
  buf.writeUInt32LE(SIZE, section + 16);
  buf.writeUInt32LE(RAW, section + 20);

  let cursor = 0;                           // offset inside the section
  const take = (n) => { const at = cursor; cursor += n; return at; };
  const table = (names, recordSize, nameField, directory) => {
    if (!names.length) return;
    const start = take((names.length + 1) * recordSize);   // the last record stays empty
    buf.writeUInt32LE(RVA + start, directories + directory * 8);
    names.forEach((name, i) => {
      const at = take(name.length + 1);
      buf.write(name, RAW + at, 'latin1');
      buf.writeUInt32LE(RVA + at, RAW + start + i * recordSize + nameField);
    });
  };
  table(imports, 20, 12, 1);
  table(delayImports, 32, 4, 13);

  const config = take(0x140);
  buf.writeUInt32LE(RVA + config, directories + 10 * 8);
  buf.writeUInt32LE(0x140, RAW + config);
  if (hybrid) buf.writeBigUInt64LE(0x180001000n, RAW + config + 0xc8);
  return buf;
}
