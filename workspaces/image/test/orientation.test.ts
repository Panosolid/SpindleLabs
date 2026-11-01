import { test } from "node:test";
import assert from "node:assert/strict";
import { orientedSize, orientPixels, readOrientation, type Orientation } from "../src/orientation.ts";
import { crc32 } from "../src/physical-size.ts";
import type { Pixels } from "../src/document.ts";
import { chunk, exifApp1, exifChunk, idat, iend, ihdr, jfif, jpeg, png, segment, sof, sos, tiffOrientation } from "./helpers.ts";

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

test("the orientation is read from a JPEG's EXIF, in either byte order", () => {
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.equal(readOrientation(jpeg(exifApp1(o, "MM"), sof(30, 20), sos()), "jpeg").orientation, o);
    assert.equal(readOrientation(jpeg(jfif(1, 72, 72), exifApp1(o, "II"), sof(30, 20), sos()), "jpeg").orientation, o);
  }
  // An APP1 between the frame header and the scan still counts (the browser reads every segment before the scan).
  assert.equal(readOrientation(jpeg(sof(30, 20), exifApp1(6), sos()), "jpeg").orientation, 6);
  // After the scan it does not.
  assert.equal(readOrientation(jpeg(sof(30, 20), sos(), exifApp1(6)), "jpeg").orientation, 1);
});

test("the orientation is read from a PNG's eXIf chunk before the image data, never after", () => {
  assert.equal(readOrientation(png(ihdr(30, 20), exifChunk(8), idat(), iend()), "png").orientation, 8);
  assert.equal(readOrientation(png(ihdr(30, 20), exifChunk(5, "II"), idat(), iend()), "png").orientation, 5);
  // Chromium ignores an eXIf after IDAT (checked in Chromium 153), so it is upright as stored.
  assert.equal(readOrientation(png(ihdr(30, 20), idat(), exifChunk(6), iend()), "png").orientation, 1);
});

test("a file with no orientation, or one the browser would ignore, is upright as stored", () => {
  const upright = (bytes: Uint8Array, format: "png" | "jpeg") => {
    const r = readOrientation(bytes, format);
    assert.equal(r.orientation, 1);
    assert.equal(r.asStored, bytes, "nothing to change: the same bytes");
  };
  upright(jpeg(sof(30, 20), sos()), "jpeg");
  upright(png(ihdr(30, 20), idat(), iend()), "png");
  // 0 and 9 are not orientations.
  upright(jpeg(exifApp1(0), sof(30, 20), sos()), "jpeg");
  upright(jpeg(exifApp1(9), sof(30, 20), sos()), "jpeg");
  // The tag as a LONG (type 4) or with count 2 is not the orientation entry the standard defines.
  upright(jpeg(segment(0xe1, [...ascii("Exif"), 0, 0, ...tiffOrientation(6, "MM", 4)]), sof(30, 20), sos()), "jpeg");
  upright(jpeg(segment(0xe1, [...ascii("Exif"), 0, 0, ...tiffOrientation(6, "MM", 3, 2)]), sof(30, 20), sos()), "jpeg");
  // An APP1 that is not EXIF (XMP), a wrong byte order mark, a wrong magic number.
  upright(jpeg(segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...tiffOrientation(6)]), sof(30, 20), sos()), "jpeg");
  const bad = tiffOrientation(6);
  bad[0] = 0x58;
  upright(jpeg(segment(0xe1, [...ascii("Exif"), 0, 0, ...bad]), sof(30, 20), sos()), "jpeg");
  const magic = tiffOrientation(6);
  magic[3] = 43;
  upright(jpeg(segment(0xe1, [...ascii("Exif"), 0, 0, ...magic]), sof(30, 20), sos()), "jpeg");
  // A PNG eXIf with a wrong checksum is thrown away by the browser's decoder, so it is not trusted either.
  upright(png(ihdr(30, 20), exifChunk(6, "MM", 1), idat(), iend()), "png");
});

test("damaged EXIF never reads out of bounds or throws: it is ignored", () => {
  // A directory offset far past the end, an entry count larger than the block, a block cut short.
  const far = tiffOrientation(6);
  far[7] = 200;
  const many = tiffOrientation(6);
  many[9] = 99;
  for (const tiff of [far, many, tiffOrientation(6).slice(0, 14), tiffOrientation(6).slice(0, 4), []]) {
    assert.equal(readOrientation(jpeg(segment(0xe1, [...ascii("Exif"), 0, 0, ...tiff]), sof(30, 20), sos()), "jpeg").orientation, 1);
    assert.equal(readOrientation(png(ihdr(30, 20), chunk("eXIf", tiff), idat(), iend()), "png").orientation, 1);
  }
  // Every cut of a good file: never a throw.
  const good = jpeg(exifApp1(6), sof(30, 20), sos());
  for (let n = 0; n <= good.length; n++) readOrientation(good.slice(0, n), "jpeg");
  const goodPng = png(ihdr(30, 20), exifChunk(6), idat(), iend());
  for (let n = 0; n <= goodPng.length; n++) readOrientation(goodPng.slice(0, n), "png");
});

test("the bytes given to the decoder have every orientation set to 1, and the original is untouched", () => {
  // JPEG, big-endian: the value sits after the 6 bytes "Exif\0\0", the 8-byte TIFF header, the 2-byte count and 8 bytes of the entry.
  const file = jpeg(exifApp1(6), sof(30, 20), exifApp1(8, "II"), sos());
  const r = readOrientation(file, "jpeg");
  assert.equal(r.orientation, 6, "the first one counts");
  assert.notEqual(r.asStored, file);
  assert.equal(readOrientation(r.asStored, "jpeg").orientation, 1);
  assert.equal(readOrientation(file, "jpeg").orientation, 6, "the file's own bytes are unchanged");
  // Only the two value bytes of each entry change (two entries, two bytes each, but the 0 high bytes already match).
  const changed = [...file].map((b, i) => (b !== r.asStored[i] ? i : -1)).filter((i) => i >= 0);
  // The first segment starts at byte 2: FF E1 (2, 3), its length (4, 5), "Exif\0\0" (6–11), so the TIFF block starts at 12:
  // header 8 bytes, count 2, then the entry's tag 2, type 2 and count 4: its value is at 12 + 8 + 2 + 8 = 30, the low byte (big-endian) at 31.
  assert.equal(changed[0], 31);
  assert.equal(r.asStored[31], 1);
  assert.equal(changed.length, 2);

  // PNG: the value changes and the chunk's checksum is made right again, so the decoder keeps the chunk.
  const p = png(ihdr(30, 20), exifChunk(6), idat(), iend());
  const q = readOrientation(p, "png").asStored;
  const at = 8 + 25; // after the signature and IHDR (4 + 4 + 13 + 4)
  const length = 26;
  assert.equal(String.fromCharCode(...q.slice(at + 4, at + 8)), "eXIf");
  const stored = new DataView(q.buffer, q.byteOffset).getUint32(at + 8 + length);
  assert.equal(stored, crc32(q, at + 4, at + 8 + length));
  assert.equal(readOrientation(q, "png").orientation, 1);
});

test("orientations 5 to 8 swap width and height; 1 to 4 keep them", () => {
  // A phone held upright stores its picture sideways (30 wide, 20 tall) and tags it 6: shown upright it is 20 wide, 30 tall.
  for (const o of [1, 2, 3, 4] as Orientation[]) assert.deepEqual(orientedSize(30, 20, o), { width: 30, height: 20 });
  for (const o of [5, 6, 7, 8] as Orientation[]) assert.deepEqual(orientedSize(30, 20, o), { width: 20, height: 30 });
});

/** A 3 × 2 image whose pixels are A B C over D E F, each pixel's red channel its letter's code. */
const ABCDEF: Pixels = {
  width: 3,
  height: 2,
  rgba: new Uint8ClampedArray([..."ABCDEF"].flatMap((c) => [c.charCodeAt(0), 1, 2, 255])),
};
const rows = (p: Pixels) => {
  const out: string[] = [];
  for (let y = 0; y < p.height; y++) {
    let row = "";
    for (let x = 0; x < p.width; x++) row += String.fromCharCode(p.rgba[4 * (y * p.width + x)]);
    out.push(row);
  }
  return out;
};

test("each orientation turns the stored pixels upright, worked by hand", () => {
  // Stored:  A B C
  //          D E F
  // EXIF says where the stored first row and column belong when shown:
  // 1 as stored; 2 mirrored left to right; 3 turned half a turn; 4 mirrored top to bottom;
  // 5 mirrored across the main diagonal (the first column becomes the first row);
  // 6 turned a quarter clockwise (the first column, read upwards, becomes the first row: D A);
  // 7 mirrored across the other diagonal (the last column, upwards, becomes the first row: F C);
  // 8 turned a quarter anticlockwise (the last column becomes the first row: C F).
  const want: Record<Orientation, string[]> = {
    1: ["ABC", "DEF"],
    2: ["CBA", "FED"],
    3: ["FED", "CBA"],
    4: ["DEF", "ABC"],
    5: ["AD", "BE", "CF"],
    6: ["DA", "EB", "FC"],
    7: ["FC", "EB", "DA"],
    8: ["CF", "BE", "AD"],
  };
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8] as Orientation[]) {
    const p = orientPixels(ABCDEF, o);
    assert.deepEqual(rows(p), want[o], `orientation ${o}`);
    assert.deepEqual({ width: p.width, height: p.height }, orientedSize(3, 2, o));
    // Every channel moves with its pixel.
    for (let i = 0; i < p.width * p.height; i++) assert.deepEqual([...p.rgba.slice(4 * i + 1, 4 * i + 4)], [1, 2, 255]);
  }
  assert.equal(orientPixels(ABCDEF, 1), ABCDEF, "upright already: no copy");
  assert.deepEqual(rows(ABCDEF), ["ABC", "DEF"], "the stored pixels are never changed");
});

test("turning is consistent: 6 then 8 is the identity, and 2, 3, 4, 5, 7 undo themselves", () => {
  // Self-consistency only (not counted as hand-worked): applying the inverse brings the stored pixels back.
  const again = (p: Pixels, o: Orientation) => orientPixels(p, o);
  assert.deepEqual(rows(again(orientPixels(ABCDEF, 6), 8)), rows(ABCDEF));
  for (const o of [2, 3, 4, 5, 7] as Orientation[]) assert.deepEqual(rows(again(orientPixels(ABCDEF, o), o)), rows(ABCDEF));
});

test("seeded fuzz: broken EXIF photos never make the orientation reader throw, and the decoder's bytes are always upright", async () => {
  const { checkOrientation, mutate, random } = await import("./fuzz-check.ts");
  const seeds = [jpeg(jfif(1, 72, 72), exifApp1(6), sof(30, 20), sos()), jpeg(exifApp1(8, "II"), sof(30, 20), sos()), png(ihdr(30, 20), exifChunk(5), idat(), iend()), png(ihdr(30, 20), exifChunk(7, "II"), idat(), iend())];
  const SEED = 0x0112;
  for (const [n, file] of seeds.entries()) {
    const rnd = random(SEED + n);
    for (let i = 0; i < 3000; i++) {
      const input = mutate(file, rnd);
      const problem = checkOrientation(input);
      assert.equal(problem, null, `seed ${SEED + n}, case ${i}: ${problem} (input ${[...input].join(",")})`);
    }
  }
});
