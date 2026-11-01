// Opening a file (G1b): the header is read and checked first, so a file
// that is too large or damaged is refused before anything decodes it; then
// the browser decodes the pixels, and the decoded width and height must
// match what the header said. A photo's EXIF orientation is applied here,
// not by the browser (orientation.ts): the decoder gets the file with its
// orientation set to 1 and must return the stored size, which is then
// turned upright (orientations 5–8 swap width and height). The decoder is
// passed in, so this runs in tests without a browser.

import { createImageDocument, type ImageDocument, type Pixels } from "./document.ts";
import { ImageError } from "./errors.ts";
import { orientPixels, readOrientation } from "./orientation.ts";
import { readPhysicalSize, type PhysicalSize } from "./physical-size.ts";

/** Turns a file's bytes into RGBA pixels as stored, never turned by an orientation tag (the browser's createImageBitmap in the app). */
export type Decoder = (bytes: Uint8Array, format: PhysicalSize["format"]) => Promise<Pixels>;

let opened = 0;

/** Reads the header, decodes and makes a one-layer document; every refusal is an ImageError with its own message. */
export async function openImage(bytes: Uint8Array, name: string, decode: Decoder): Promise<ImageDocument> {
  const size = readPhysicalSize(bytes); // checks the pixel limits before anything is decoded
  const { orientation, asStored } = readOrientation(bytes, size.format);
  let pixels: Pixels;
  try {
    pixels = await decode(asStored, size.format);
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("damaged", `The headers look right, but the browser could not decode the picture in this ${size.format.toUpperCase()} file.`);
  }
  if (pixels.width !== size.width || pixels.height !== size.height) {
    throw new ImageError("damaged", `The file's header says ${size.width} × ${size.height} pixels but it decoded to ${pixels.width} × ${pixels.height}.`);
  }
  const upright = orientPixels(pixels, orientation);
  return createImageDocument(`image-${++opened}`, name, upright, { ...size, width: upright.width, height: upright.height });
}
