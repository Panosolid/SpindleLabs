// Helpers for the shapes and selection hunt (2026-11-01).
import assert from "node:assert/strict";
import { app } from "./design-app.ts";
import type { DesignDocument } from "@fission/design";
export const empty = (): DesignDocument => ({ version: 7, nextId: 1, profiles: [], sketches: [], timeline: { features: [] } }) as never;
type A = Awaited<ReturnType<typeof app>>;
export async function insert(a: A, kind: string) {
  (a.$("#insert") as HTMLButtonElement).click();
  await a.settle();
  (a.$(`#insert-${kind}`) as HTMLButtonElement).click();
  await a.settle();
}
export async function type(a: A, key: string, v: string, leave = false) {
  const el = a.$(`#${key}`) as HTMLInputElement;
  el.value = v;
  el.dispatchEvent(new a.window.Event("input") as unknown as Event);
  await a.settle();
  if (leave) {
    el.dispatchEvent(new a.window.Event("change") as unknown as Event);
    await a.settle();
  }
}
export async function row(a: A, node: string) {
  const r = [...a.window.document.querySelectorAll<HTMLElement>(".tree-row")].find((x) => (x as HTMLElement).dataset.node === node) as HTMLElement | undefined;
  assert.ok(r, `row ${node}`);
  r.click();
  await a.settle();
}
const num = (s: string | null) => Number((s ?? "").replace(/[^0-9.\-]/g, ""));
export const panel = (a: A) => ({ heading: a.$("#body-heading")!.textContent, volume: num(a.$("#volume")!.textContent), area: num(a.$("#area")!.textContent), intent: a.$("#intent")!.textContent, error: a.$("#error")!.textContent });
