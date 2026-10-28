import { launch } from "./browser.mjs";
import { preview } from "vite";
const server = await preview({ preview: { port: 4238, strictPort: true }, logLevel: "error" });
const browser = await launch();
for (const [w, h] of [[568, 320], [640, 360], [402, 874], [320,568]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const p = await c.newPage();
  await p.goto("http://localhost:4238/"); await p.waitForSelector("#start-hint", { state: "visible" }); await p.waitForTimeout(400);
  console.log(w, h, JSON.stringify(await p.evaluate(() => Object.fromEntries(["#viewport", "#browser-toggle", "#properties-toggle", ".view-cube", ".view-controls", "#undo-redo", "#start-hint", "#start-hint-words", ".start-hint-actions"].map((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [s, [r.left, r.top, r.right, r.bottom].map(Math.round)]; })))));
  await c.close();
}
await browser.close(); await server.close();
