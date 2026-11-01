// Hand-built PNG and JPEG headers for the tests. Only the headers matter:
// the readers never decode pixels.

import { crc32 } from "../src/physical-size.ts";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** One PNG chunk: length, type, data, CRC over type and data. */
export function chunk(type: string, data: number[], crcFix = 0): number[] {
  const body = new Uint8Array([...ascii(type), ...data]);
  return [...be32(data.length), ...body, ...be32((crc32(body) ^ crcFix) >>> 0)];
}

export const ihdr = (width: number, height: number) => chunk("IHDR", [...be32(width), ...be32(height), 8, 6, 0, 0, 0]);
export const phys = (x: number, y: number, unit: number) => chunk("pHYs", [...be32(x), ...be32(y), unit]);
export const idat = () => chunk("IDAT", [0x78, 0x9c]);
export const iend = () => chunk("IEND", []);

export function png(...chunks: number[][]): Uint8Array {
  return new Uint8Array([...PNG_SIGNATURE, ...chunks.flat()]);
}

/** A JPEG segment: FF marker, then a length that counts itself. */
export function segment(marker: number, data: number[]): number[] {
  return [0xff, marker, ...be16(data.length + 2), ...data];
}

/** JFIF APP0: "JFIF\0", version 1.02, units (0 aspect, 1 per inch, 2 per cm), x and y density, no thumbnail. */
export const jfif = (unit: number, x: number, y: number) => segment(0xe0, [...ascii("JFIF"), 0, 1, 2, unit, ...be16(x), ...be16(y), 0, 0]);
/** A baseline (SOF0) frame header: 8-bit, height, width, one component. */
export const sof = (width: number, height: number, marker = 0xc0) => segment(marker, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]);
export const sos = () => segment(0xda, [1, 1, 0, 0, 63, 0]);

/**
 * A TIFF block (as EXIF stores it) whose first directory holds one entry,
 * the orientation (tag 0x0112, type 3 SHORT, count 1); `order` "MM" is big-endian, "II" little-endian.
 * `type` and `count` can be changed to make a broken entry.
 */
export function tiffOrientation(orientation: number, order: "MM" | "II" = "MM", type = 3, count = 1): number[] {
  const le = order === "II";
  const u16 = (n: number) => (le ? be16(n).reverse() : be16(n));
  const u32 = (n: number) => (le ? be32(n).reverse() : be32(n));
  // Header: byte order, 42, offset 8 of the first directory; then 1 entry of 12 bytes and the next directory's offset (0: none).
  return [...ascii(order), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(type), ...u32(count), ...u16(orientation), 0, 0, ...u32(0)];
}
/** A JPEG APP1 segment holding EXIF: "Exif\0\0" then the TIFF block. */
export const exifApp1 = (orientation: number, order: "MM" | "II" = "MM") => segment(0xe1, [...ascii("Exif"), 0, 0, ...tiffOrientation(orientation, order)]);
/** A PNG eXIf chunk: the TIFF block alone. */
export const exifChunk = (orientation: number, order: "MM" | "II" = "MM", crcFix = 0) => chunk("eXIf", tiffOrientation(orientation, order), crcFix);

export function jpeg(...segments: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), 0xff, 0xd9]);
}

/** Runs fn and returns the ImageError's code and message, or fails. */
export function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (e) {
    const err = e as { name?: string; code: string; message: string };
    if (err.name !== "ImageError") throw e;
    return { code: err.code, message: err.message };
  }
  throw new Error("expected an ImageError, but nothing was thrown");
}
