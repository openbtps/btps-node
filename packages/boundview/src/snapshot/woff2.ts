/**
 * @license
 * Copyright (c) 2025 Bhupendra Tamang
 * Licensed under the Apache License, Version 2.0
 * https://www.apache.org/licenses/LICENSE-2.0
 */

/*
 * A WOFF2 font file as the OpenType font it compresses (W3C WOFF2, section 5),
 * so a page that serves its fonts as woff2, as most do, has them read like any
 * other: its tables Brotli-decompressed, and its glyf, loca and hmtx rebuilt
 * from their transformed forms. Font collections are not read.
 */

const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

/** Whether `bytes` is a WOFF2 font file. */
export const isWoff2 = (bytes: ArrayBuffer) =>
  bytes.byteLength >= 4 && new DataView(bytes).getUint32(0) === 0x774f4632; // 'wOF2'

class Reader {
  at = 0;
  constructor(readonly view: DataView) {}
  u8() {
    return this.view.getUint8(this.at++);
  }
  u16() {
    const value = this.view.getUint16(this.at);
    this.at += 2;
    return value;
  }
  i16() {
    const value = this.view.getInt16(this.at);
    this.at += 2;
    return value;
  }
  u32() {
    const value = this.view.getUint32(this.at);
    this.at += 4;
    return value;
  }
  base128() {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      if (i === 0 && byte === 0x80) throw new Error('WOFF2: a UIntBase128 with a leading zero');
      if (value & 0xfe000000) throw new Error('WOFF2: a UIntBase128 too large');
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value >>> 0;
    }
    throw new Error('WOFF2: a UIntBase128 longer than 5 bytes');
  }
  u255() {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return this.u8() + 253;
    if (code === 254) return this.u8() + 506;
    return code;
  }
  bytes(length: number) {
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.at, length);
    this.at += length;
    return out;
  }
}

const sub = (bytes: Uint8Array, from: number, length: number) => {
  if (from + length > bytes.length) throw new Error('WOFF2: a stream runs past its table');
  return new Reader(new DataView(bytes.buffer, bytes.byteOffset + from, length));
};

/** A growing byte buffer. */
class Writer {
  bytes = new Uint8Array(1024);
  length = 0;
  private room(extra: number) {
    if (this.length + extra <= this.bytes.length) return;
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + extra));
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
  }
  u8(value: number) {
    this.room(1);
    this.bytes[this.length++] = value & 0xff;
  }
  u16(value: number) {
    this.u8(value >> 8);
    this.u8(value);
  }
  u32(value: number) {
    this.u16(value >>> 16);
    this.u16(value);
  }
  raw(data: Uint8Array) {
    this.room(data.length);
    this.bytes.set(data, this.length);
    this.length += data.length;
  }
  pad4() {
    while (this.length % 4 !== 0) this.u8(0);
  }
  done() {
    return this.bytes.slice(0, this.length);
  }
}

const withSign = (flag: number, value: number) => (flag & 1 ? value : -value);

/** One point's coordinates from the glyph stream, by its flag's triplet encoding. */
const triplet = (flag: number, glyphs: Reader): [number, number] => {
  if (flag < 10) return [0, withSign(flag, ((flag & 14) << 7) + glyphs.u8())];
  if (flag < 20) return [withSign(flag, (((flag - 10) & 14) << 7) + glyphs.u8()), 0];
  if (flag < 84) {
    const b0 = flag - 20;
    const b1 = glyphs.u8();
    return [withSign(flag, 1 + (b0 & 0x30) + (b1 >> 4)), withSign(flag >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f))];
  }
  if (flag < 120) {
    const b0 = flag - 84;
    const dx = withSign(flag, 1 + (Math.floor(b0 / 12) << 8) + glyphs.u8());
    return [dx, withSign(flag >> 1, 1 + (((b0 % 12) >> 2) << 8) + glyphs.u8())];
  }
  if (flag < 124) {
    const b0 = glyphs.u8();
    const b1 = glyphs.u8();
    const b2 = glyphs.u8();
    return [withSign(flag, (b0 << 4) + (b1 >> 4)), withSign(flag >> 1, ((b1 & 0x0f) << 8) + b2)];
  }
  const dx = glyphs.u16();
  return [withSign(flag, dx), withSign(flag >> 1, glyphs.u16())];
};

/** A simple glyph in the glyf table's own encoding. */
const simpleGlyph = (
  ends: number[],
  points: { x: number; y: number; on: boolean }[],
  bbox: [number, number, number, number],
  instructions: Uint8Array,
  overlap: boolean,
) => {
  const out = new Writer();
  out.u16(ends.length);
  for (const value of bbox) out.u16(value);
  for (const end of ends) out.u16(end);
  out.u16(instructions.length);
  out.raw(instructions);
  const xs = new Writer();
  const ys = new Writer();
  let [x, y] = [0, 0];
  points.forEach((point, i) => {
    let flag = point.on ? 0x01 : 0;
    if (i === 0 && overlap) flag |= 0x40;
    const dx = point.x - x;
    const dy = point.y - y;
    if (dx === 0) flag |= 0x10;
    else if (dx >= -255 && dx <= 255) {
      flag |= 0x02 | (dx > 0 ? 0x10 : 0);
      xs.u8(Math.abs(dx));
    } else xs.u16(dx);
    if (dy === 0) flag |= 0x20;
    else if (dy >= -255 && dy <= 255) {
      flag |= 0x04 | (dy > 0 ? 0x20 : 0);
      ys.u8(Math.abs(dy));
    } else ys.u16(dy);
    out.u8(flag);
    [x, y] = [point.x, point.y];
  });
  out.raw(xs.done());
  out.raw(ys.done());
  return out.done();
};

/** The glyf and loca tables from their WOFF2 transform (section 5.1), and each glyph's xMin for hmtx. */
const rebuildGlyf = (data: Uint8Array) => {
  const head = sub(data, 0, 36);
  head.u16(); // version
  const options = head.u16();
  const numGlyphs = head.u16();
  const indexFormat = head.u16();
  const sizes = [head.u32(), head.u32(), head.u32(), head.u32(), head.u32(), head.u32(), head.u32()];
  let offset = 36;
  const streams = sizes.map((size) => {
    const stream = sub(data, offset, size);
    offset += size;
    return stream;
  });
  const [contours, pointCounts, flags, glyphs, composites, bboxes, instructionStream] = streams as [
    Reader, Reader, Reader, Reader, Reader, Reader, Reader,
  ];
  const overlapBits = options & 1 ? sub(data, offset, (numGlyphs + 7) >> 3).bytes((numGlyphs + 7) >> 3) : undefined;
  const bitmapLength = ((numGlyphs + 31) >> 5) << 2;
  const bboxBitmap = bboxes.bytes(bitmapLength);
  const hasBbox = (i: number) => ((bboxBitmap[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0;

  const glyf = new Writer();
  const loca: number[] = [];
  const xMins: number[] = [];
  for (let i = 0; i < numGlyphs; i++) {
    loca.push(glyf.length);
    const count = contours.i16();
    if (count === 0) {
      xMins.push(0);
      continue;
    }
    if (count === -1) {
      // A composite: its components as they are, its bounding box always given.
      const start = composites.at;
      let more = true;
      let instructed = false;
      while (more) {
        const flag = composites.u16();
        composites.u16();
        composites.at += flag & 0x0001 ? 4 : 2;
        composites.at += flag & 0x0008 ? 2 : flag & 0x0040 ? 4 : flag & 0x0080 ? 8 : 0;
        instructed ||= (flag & 0x0100) !== 0;
        more = (flag & 0x0020) !== 0;
      }
      const components = new Uint8Array(composites.view.buffer, composites.view.byteOffset + start, composites.at - start);
      if (!hasBbox(i)) throw new Error('WOFF2: a composite glyph without its bounding box');
      const box = [bboxes.i16(), bboxes.i16(), bboxes.i16(), bboxes.i16()];
      glyf.u16(0xffff);
      for (const value of box) glyf.u16(value);
      glyf.raw(components);
      if (instructed) {
        const length = glyphs.u255();
        glyf.u16(length);
        glyf.raw(instructionStream.bytes(length));
      }
      glyf.pad4();
      xMins.push(box[0] as number);
      continue;
    }
    const ends: number[] = [];
    let total = 0;
    for (let c = 0; c < count; c++) {
      total += pointCounts.u255();
      ends.push(total - 1);
    }
    const points: { x: number; y: number; on: boolean }[] = [];
    let [x, y] = [0, 0];
    for (let p = 0; p < total; p++) {
      const flag = flags.u8();
      const [dx, dy] = triplet(flag & 0x7f, glyphs);
      x += dx;
      y += dy;
      points.push({ x, y, on: (flag & 0x80) === 0 });
    }
    const instructionLength = glyphs.u255();
    const instructions = instructionStream.bytes(instructionLength);
    let box: [number, number, number, number];
    if (hasBbox(i)) box = [bboxes.i16(), bboxes.i16(), bboxes.i16(), bboxes.i16()];
    else {
      const px = points.map((point) => point.x);
      const py = points.map((point) => point.y);
      box = [Math.min(...px), Math.min(...py), Math.max(...px), Math.max(...py)];
    }
    const overlap = overlapBits !== undefined && ((overlapBits[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0;
    glyf.raw(simpleGlyph(ends, points, box, instructions, overlap));
    glyf.pad4();
    xMins.push(box[0]);
  }
  loca.push(glyf.length);
  const locaOut = new Writer();
  for (const at of loca) {
    if (indexFormat === 0) locaOut.u16(at >> 1);
    else locaOut.u32(at);
  }
  return { glyf: glyf.done(), loca: locaOut.done(), xMins };
};

/** The hmtx table from its WOFF2 transform (section 5.4): left side bearings left out are each glyph's xMin. */
const rebuildHmtx = (data: Uint8Array, numGlyphs: number, numberOfHMetrics: number, xMins: number[]) => {
  const reader = sub(data, 0, data.length);
  const flags = reader.u8();
  const advances = Array.from({ length: numberOfHMetrics }, () => reader.u16());
  const proportional = Array.from({ length: numberOfHMetrics }, (_, i) => (flags & 1 ? (xMins[i] ?? 0) : reader.i16()));
  const monospaced = Array.from({ length: numGlyphs - numberOfHMetrics }, (_, i) =>
    flags & 2 ? (xMins[numberOfHMetrics + i] ?? 0) : reader.i16(),
  );
  const out = new Writer();
  advances.forEach((advance, i) => {
    out.u16(advance);
    out.u16(proportional[i] as number);
  });
  for (const bearing of monospaced) out.u16(bearing);
  return out.done();
};

const checksum = (bytes: Uint8Array) => {
  const padded = new Uint8Array((bytes.length + 3) & ~3);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
};

/** The OpenType font a WOFF2 file holds. `decompress` is Brotli's. */
export const woff2ToSfnt = (file: ArrayBuffer, decompress: (data: Uint8Array) => Uint8Array): ArrayBuffer => {
  const reader = new Reader(new DataView(file));
  if (reader.u32() !== 0x774f4632) throw new Error('WOFF2: not a WOFF2 file');
  const flavor = reader.u32();
  if (flavor === 0x74746366) throw new Error('WOFF2: a font collection is not read');
  reader.u32(); // length
  const numTables = reader.u16();
  reader.u16(); // reserved
  reader.u32(); // totalSfntSize
  const compressedSize = reader.u32();
  reader.at = 48;
  const tables: { tag: string; length: number; transformed: boolean; offset: number; size: number }[] = [];
  let at = 0;
  for (let i = 0; i < numTables; i++) {
    const flag = reader.u8();
    const known = flag & 0x3f;
    const tag = known === 63 ? String.fromCharCode(reader.u8(), reader.u8(), reader.u8(), reader.u8()) : KNOWN_TAGS[known];
    if (tag === undefined) throw new Error('WOFF2: an unknown table tag');
    const version = flag >> 6;
    const length = reader.base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : tag === 'hmtx' ? version === 1 : false;
    if (version !== 0 && tag !== 'glyf' && tag !== 'loca' && tag !== 'hmtx') throw new Error(`WOFF2: ${tag} has an unknown transform`);
    const size = transformed ? reader.base128() : length;
    tables.push({ tag, length, transformed, offset: at, size });
    at += size;
  }
  const data = decompress(new Uint8Array(file, reader.at, compressedSize));
  if (data.length < at) throw new Error('WOFF2: the compressed tables are shorter than their directory');
  const raw = (table: (typeof tables)[number]) => data.subarray(table.offset, table.offset + table.size);
  const named = (tag: string) => tables.find((table) => table.tag === tag);

  const out = new Map<string, Uint8Array>();
  for (const table of tables) if (!table.transformed) out.set(table.tag, raw(table));
  const glyfTable = named('glyf');
  let xMins: number[] = [];
  if (glyfTable?.transformed) {
    const rebuilt = rebuildGlyf(raw(glyfTable));
    out.set('glyf', rebuilt.glyf);
    out.set('loca', rebuilt.loca);
    xMins = rebuilt.xMins;
  }
  const hmtx = named('hmtx');
  if (hmtx?.transformed) {
    const maxp = out.get('maxp');
    const hhea = out.get('hhea');
    if (!maxp || !hhea) throw new Error('WOFF2: hmtx is transformed without maxp and hhea');
    const numGlyphs = new DataView(maxp.buffer, maxp.byteOffset).getUint16(4);
    const numberOfHMetrics = new DataView(hhea.buffer, hhea.byteOffset).getUint16(34);
    out.set('hmtx', rebuildHmtx(raw(hmtx), numGlyphs, numberOfHMetrics, xMins));
  }

  // The font as an OpenType file: its table directory, in tag order, then each table on a 4-byte boundary.
  const tags = [...out.keys()].sort();
  const sfnt = new Writer();
  const search = 2 ** Math.floor(Math.log2(tags.length));
  sfnt.u32(flavor);
  sfnt.u16(tags.length);
  sfnt.u16(search * 16);
  sfnt.u16(Math.log2(search));
  sfnt.u16(tags.length * 16 - search * 16);
  let offset = 12 + tags.length * 16;
  for (const tag of tags) {
    const bytes = out.get(tag) as Uint8Array;
    for (const char of tag) sfnt.u8(char.charCodeAt(0));
    sfnt.u32(checksum(bytes));
    sfnt.u32(offset);
    sfnt.u32(bytes.length);
    offset += (bytes.length + 3) & ~3;
  }
  for (const tag of tags) {
    sfnt.raw(out.get(tag) as Uint8Array);
    sfnt.pad4();
  }
  const bytes = sfnt.done();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
};
