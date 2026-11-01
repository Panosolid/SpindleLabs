import { test } from "node:test";
import assert from "node:assert/strict";
import { openImage, type Decoder } from "../src/open.ts";
import { physicalSize, type Pixels } from "../src/document.ts";
import { exifApp1, exifChunk, idat, iend, ihdr, jpeg, phys, png, refusal, sof, sos } from "./helpers.ts";

/** A decoder that returns blank pixels of the given size and counts its calls. */
function fakeDecoder(width: number, height: number) {
  const calls: string[] = [];
  const decode: Decoder = async (_bytes, format) => {
    calls.push(format);
    return { width, height, rgba: new Uint8ClampedArray(width * height * 4) } satisfies Pixels;
  };
  return { decode, calls };
}

/** Like `refusal`, for a promise. */
async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return refusal(() => {
      throw e;
    });
  }
  throw new Error("expected an ImageError, but the promise resolved");
}

// 254 DPI = 10000 pixels per metre (pHYs unit 1) = 10 px per mm, so one pixel is 0.1 mm.
const file200x100 = png(ihdr(200, 100), phys(10000, 10000, 1), idat(), iend());

test("a 200 × 100 PNG at 254 DPI opens as one layer, 20 × 10 mm", async () => {
  const { decode, calls } = fakeDecoder(200, 100);
  const doc = await openImage(file200x100, "plate.png", decode);
  // 200 px × 0.1 mm = 20 mm wide; 100 px × 0.1 mm = 10 mm tall.
  const { widthMm, heightMm } = physicalSize(doc);
  assert.ok(Math.abs(widthMm - 20) < 1e-12 && Math.abs(heightMm - 10) < 1e-12, `${widthMm} × ${heightMm}`);
  assert.equal(doc.name, "plate.png");
  assert.equal(doc.sizeSource, "file");
  assert.equal(doc.layers.length, 1);
  assert.deepEqual(calls, ["png"]);
});

test("each opened image gets its own id", async () => {
  const a = await openImage(file200x100, "a.png", fakeDecoder(200, 100).decode);
  const b = await openImage(file200x100, "b.png", fakeDecoder(200, 100).decode);
  assert.notEqual(a.id, b.id);
});

test("pixels that decode to a different size than the header says are refused", async () => {
  const r = await refused(openImage(file200x100, "x.png", fakeDecoder(100, 200).decode));
  assert.equal(r.code, "damaged");
  assert.equal(r.message, "The file's header says 200 × 100 pixels but it decoded to 100 × 200.");
});

test("a file too large for the limits is refused before anything decodes it", async () => {
  const { decode, calls } = fakeDecoder(16385, 1);
  const r = await refused(openImage(png(ihdr(16385, 1), idat(), iend()), "wide.png", decode));
  assert.equal(r.code, "too-large");
  assert.deepEqual(calls, [], "the decoder was never called");
  // The largest side that is allowed still opens.
  const ok = fakeDecoder(16384, 1);
  await openImage(png(ihdr(16384, 1), idat(), iend()), "edge.png", ok.decode);
  assert.deepEqual(ok.calls, ["png"]);
});

test("a file that is not an image is refused before anything decodes it", async () => {
  const { decode, calls } = fakeDecoder(1, 1);
  const r = await refused(openImage(new TextEncoder().encode("hello"), "notes.txt", decode));
  assert.equal(r.code, "not-an-image");
  assert.deepEqual(calls, []);
});

test("the browser failing to decode good-looking headers is reported as damaged, with the format", async () => {
  const decode: Decoder = async () => {
    throw new DOMException("The source image could not be decoded.", "InvalidStateError");
  };
  const r = await refused(openImage(file200x100, "x.png", decode));
  assert.equal(r.code, "damaged");
  assert.equal(r.message, "The headers look right, but the browser could not decode the picture in this PNG file.");
});

/**
 * A decoder that behaves like current Chromium: it turns the picture by the
 * EXIF orientation it finds in the bytes it is given (createImageBitmap's
 * imageOrientation "none" no longer stops it). It finds the tag by its
 * big-endian bytes (tag 0112, type 3, count 1, value), independently of
 * src/orientation.ts. The stored picture is `width` × `height`, and pixel
 * (x, y) of the stored picture has red = 10 × y + x.
 */
function turningDecoder(width: number, height: number): Decoder {
  return async (bytes) => {
    let o = 1;
    for (let i = 0; i + 10 <= bytes.length; i++) {
      if ([0x01, 0x12, 0, 3, 0, 0, 0, 1, 0].every((b, k) => bytes[i + k] === b)) {
        o = bytes[i + 9];
        break;
      }
    }
    const swap = o >= 5 && o <= 8;
    const w = swap ? height : width;
    const h = swap ? width : height;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Only orientations 1 and 6 are modelled: 6 shows stored (sx, sy) = (y, height − 1 − x).
        const [sx, sy] = o === 6 ? [y, height - 1 - x] : [x, y];
        rgba.set([10 * sy + sx, 0, 0, 255], 4 * (y * w + x));
      }
    return { width: w, height: h, rgba };
  };
}

// Regression (files hunt, 2026-11-01): every portrait phone photo was refused as damaged.
test("a portrait phone photo (EXIF orientation 6, stored 3 × 2) opens upright as 2 × 3, not refused as damaged", async () => {
  const photo = jpeg(exifApp1(6), sof(3, 2), sos());
  const doc = await openImage(photo, "portrait.jpg", turningDecoder(3, 2));
  assert.deepEqual([doc.width, doc.height], [2, 3]);
  const reds = (p: Pixels) => Array.from({ length: p.width * p.height }, (_, i) => p.rgba[4 * i]);
  // Stored, red = 10y + x:  0  1  2
  //                         10 11 12
  // Turned a quarter clockwise (orientation 6) the first column, read upwards, is the first row:
  //   10  0
  //   11  1
  //   12  2
  assert.deepEqual(reds(doc.layers[0].pixels), [10, 0, 11, 1, 12, 2]);
  // An upright photo is unchanged.
  const plain = await openImage(jpeg(exifApp1(1), sof(3, 2), sos()), "plain.jpg", turningDecoder(3, 2));
  assert.deepEqual([plain.width, plain.height, ...reds(plain.layers[0].pixels)], [3, 2, 0, 1, 2, 10, 11, 12]);
});

test("a PNG with eXIf orientation 8 opens 20 × 30 from its 30 × 20 header", async () => {
  // Stored 30 wide, 20 tall; a quarter turn anticlockwise shows it 20 wide, 30 tall.
  const doc = await openImage(png(ihdr(30, 20), exifChunk(8), idat(), iend()), "turned.png", fakeDecoder(30, 20).decode);
  assert.deepEqual([doc.width, doc.height], [20, 30]);
  // A decoder that still turned the picture is caught: the stored size was expected.
  const r = await refused(openImage(png(ihdr(30, 20), exifChunk(8), idat(), iend()), "turned.png", fakeDecoder(20, 30).decode));
  assert.equal(r.message, "The file's header says 30 × 20 pixels but it decoded to 20 × 30.");
});
