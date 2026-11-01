// A photo's EXIF orientation (tag 0x0112): phones store a portrait photo
// sideways and say how to turn it. Browsers turn it themselves while
// decoding, and createImageBitmap's imageOrientation "none" no longer stops
// that in current Chromium, so the turning is done here instead, the same in
// every browser: the decoder is given the file with each orientation set to
// 1 (it then returns the pixels as stored, whose size the header gives), and
// orientPixels turns them upright.
//
// Where the browser reads it, so is it read here: a JPEG's APP1 "Exif"
// segments before the scan (the first with a valid entry counts), and a
// PNG's eXIf chunk before the image data with a correct checksum (Chromium
// ignores one after IDAT). An entry counts only as the EXIF standard
// writes it: type SHORT, count 1, value 1–8. Anything damaged or unexpected
// is ignored (upright as stored), never refused: the header reader
// (physical-size.ts) has already accepted the file, and the decoded size is
// still checked against the header.

import type { Pixels } from "./document.ts";
import type { PhysicalSize } from "./physical-size.ts";
import { crc32 } from "./physical-size.ts";

/** EXIF orientation: 1 upright, 2 mirrored, 3 half turn, 4 mirrored top to bottom, 5 transposed, 6 quarter turn clockwise, 7 transversed, 8 quarter turn anticlockwise. */
export type Orientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface OrientationInfo {
  orientation: Orientation;
  /** The file with every orientation entry set to 1, for the decoder; the same array when nothing needed changing. */
  asStored: Uint8Array;
}

/** Where an orientation value sits in the file, and how to fix up the chunk around it (PNG's checksum). */
interface Found {
  value: number;
  at: number;
  littleEndian: boolean;
  /** PNG: the chunk's type start and data end, for the checksum after it. */
  crc?: { start: number; end: number };
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

/** The orientation entry in a TIFF block at [start, end), or null. Every read is bounds-checked. */
function tiffEntry(b: Uint8Array, start: number, end: number): Omit<Found, "crc"> | null {
  if (end - start < 8) return null;
  const le = b[start] === 0x49 && b[start + 1] === 0x49; // "II"
  const be = b[start] === 0x4d && b[start + 1] === 0x4d; // "MM"
  if (!le && !be) return null;
  const r16 = (i: number) => (le ? b[i] | (b[i + 1] << 8) : u16be(b, i));
  const r32 = (i: number) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : u32be(b, i));
  if (r16(start + 2) !== 42) return null;
  const ifd = r32(start + 4);
  if (ifd > end - start - 2) return null;
  const count = r16(start + ifd);
  if (start + ifd + 2 + 12 * count > end) return null; // a directory longer than its block is damaged
  for (let k = 0; k < count; k++) {
    const e = start + ifd + 2 + 12 * k;
    if (r16(e) !== 0x0112) continue;
    if (r16(e + 2) !== 3 || r32(e + 4) !== 1) return null;
    return { value: r16(e + 8), at: e + 8, littleEndian: le };
  }
  return null;
}

function jpegEntries(b: Uint8Array): Found[] {
  const out: Found[] = [];
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // the scan: the browser has read everything it uses
    const length = u16be(b, pos + 2);
    const data = pos + 4;
    const end = pos + 2 + length;
    if (length < 2 || end > b.length) break;
    if (marker === 0xe1 && end - data >= 6 && [0x45, 0x78, 0x69, 0x66, 0, 0].every((c, i) => b[data + i] === c)) {
      const e = tiffEntry(b, data + 6, end);
      if (e) out.push(e);
    }
    pos = end;
  }
  return out;
}

function pngEntries(b: Uint8Array): Found[] {
  let pos = 8;
  while (pos + 12 <= b.length) {
    const length = u32be(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = pos + 8;
    if (length > 0x7fffffff || data + length + 4 > b.length) break;
    if (type === "IDAT" || type === "IEND") break;
    if (type === "eXIf") {
      if (crc32(b, pos + 4, data + length) !== u32be(b, data + length)) return []; // the decoder throws it away
      const e = tiffEntry(b, data, data + length);
      return e ? [{ ...e, crc: { start: pos + 4, end: data + length } }] : [];
    }
    pos = data + length + 4;
  }
  return [];
}

const isOrientation = (v: number): v is Orientation => Number.isInteger(v) && v >= 1 && v <= 8;

/** The file's orientation and the bytes for the decoder (see the top of this file). Never throws. */
export function readOrientation(bytes: Uint8Array, format: PhysicalSize["format"]): OrientationInfo {
  const found = (format === "jpeg" ? jpegEntries(bytes) : pngEntries(bytes)).filter((f) => isOrientation(f.value));
  const first = found[0]?.value ?? 1;
  const change = found.filter((f) => f.value !== 1);
  if (change.length === 0) return { orientation: first as Orientation, asStored: bytes };
  const copy = bytes.slice();
  for (const f of change) {
    copy[f.at] = f.littleEndian ? 1 : 0;
    copy[f.at + 1] = f.littleEndian ? 0 : 1;
    if (f.crc) {
      const c = crc32(copy, f.crc.start, f.crc.end);
      copy.set([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255, c & 255], f.crc.end);
    }
  }
  return { orientation: first as Orientation, asStored: copy };
}

/** The size shown upright: orientations 5–8 swap width and height. */
export function orientedSize(width: number, height: number, o: Orientation): { width: number; height: number } {
  return o >= 5 ? { width: height, height: width } : { width, height };
}

/** The stored pixels turned upright: a new copy (the same object for orientation 1). */
export function orientPixels(p: Pixels, o: Orientation): Pixels {
  if (o === 1) return p;
  const W = p.width;
  const H = p.height;
  const { width, height } = orientedSize(W, H, o);
  const rgba = p.rgba.byteOffset % 4 === 0 ? p.rgba : p.rgba.slice(); // a 32-bit view needs an aligned start
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H);
  const out = new Uint8ClampedArray(width * height * 4);
  const dst = new Uint32Array(out.buffer);
  // For each upright pixel (x, y), the stored pixel (sx, sy) it shows.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx: number, sy: number;
      switch (o) {
        case 2: sx = W - 1 - x; sy = y; break;
        case 3: sx = W - 1 - x; sy = H - 1 - y; break;
        case 4: sx = x; sy = H - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = H - 1 - x; break;
        case 7: sx = W - 1 - y; sy = H - 1 - x; break;
        default: sx = W - 1 - y; sy = x; break; // 8
      }
      dst[y * width + x] = src[sy * W + sx];
    }
  }
  return { width, height, rgba: out };
}
