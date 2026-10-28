import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { licencesPlugin } from "./licences.mjs";
import { offlinePlugin } from "./offline.mjs";

// The kernel's own licence (it comes with each kernel release) beside the app as
// kernel-licence.txt, so the live site carries it, not only the repository.
const kernelLicence = {
  name: "kernel-licence",
  generateBundle() {
    const source = readFileSync(new URL("../../packages/core/src/kernel/wasm/LICENSE-KERNEL.txt", import.meta.url), "utf8");
    this.emitFile({ type: "asset", fileName: "kernel-licence.txt", source });
  },
};

export default defineConfig({
  // Relative paths so the built site works from any URL, including GitHub Pages.
  base: "./",
  // The kernel worker imports the wasm-bindgen ES module.
  worker: { format: "es", plugins: () => [licencesPlugin({ emit: false })] },
  // third-party-licences.txt beside the app, checked against what is bundled (audit L2).
  // sw.js, written last from every file of the build (offline mode, offline.mjs).
  plugins: [licencesPlugin({ emit: true }), kernelLicence, offlinePlugin()],
});
