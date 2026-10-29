// The reopen guard (security audit S2): a project that froze or crashed the
// tab while opening is skipped once on the next visit, and every other
// project reopens as before. Visits are played out on a fake clock and a
// fake localStorage that outlives each page, as the browser's does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASK_MS, OPENING_KEY, reopenGuard, SETTLED_MS, type MarkStorage, type OpeningChannel, type Timers } from "../src/index.ts";

/** A fake clock for one page: timers run only when the test moves time on. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      pending.set(next, { at: now + ms, fn });
      return next++;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { timers, advance };
}

/** localStorage as a Map; `items` shows what it holds. */
function fakeStorage(): MarkStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return { items, getItem: (k) => items.get(k) ?? null, setItem: (k, v) => void items.set(k, v), removeItem: (k) => void items.delete(k) };
}

test("a visit story, worked by hand: opened fine, froze, skipped once, tried again", () => {
  const storage = fakeStorage();
  const page = () => {
    const clock = fakeTimers();
    return { clock, guard: reopenGuard(storage, { timers: clock.timers }) };
  };
  // Visit 1: nothing marked, so p1 opens; the mark names it until the tab has run SETTLED_MS after showing it.
  let v = page();
  assert.equal(v.guard.stuck("p1"), false);
  v.guard.opening("p1");
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  v.guard.shown("p1");
  v.clock.advance(SETTLED_MS - 1);
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  v.clock.advance(1);
  assert.equal(storage.items.has(OPENING_KEY), false);
  // Visit 2: p1 reopens and freezes the tab before it is shown: the mark stays.
  v = page();
  assert.equal(v.guard.stuck("p1"), false);
  v.guard.opening("p1");
  // Visit 3: the mark names p1, so p1 is skipped, and the mark is gone.
  v = page();
  assert.equal(v.guard.stuck("p1"), true);
  assert.equal(storage.items.has(OPENING_KEY), false);
  // Visit 4: p1 is tried again.
  v = page();
  assert.equal(v.guard.stuck("p1"), false);
});

test("the mark clears at SETTLED_MS: still there at 0.9×, gone at 1.1×", () => {
  for (const [fraction, left] of [[0.9, true], [1.1, false]] as const) {
    const storage = fakeStorage();
    const clock = fakeTimers();
    const guard = reopenGuard(storage, { timers: clock.timers });
    guard.opening("p1");
    guard.shown("p1");
    clock.advance(fraction * SETTLED_MS);
    assert.equal(storage.items.has(OPENING_KEY), left, `${fraction}×`);
  }
  assert.equal(SETTLED_MS, 3000);
});

test("a mark for another project skips nothing, and is cleared", () => {
  const storage = fakeStorage();
  storage.items.set(OPENING_KEY, "p2"); // p2 froze, then p1 was saved more recently in another tab
  assert.equal(reopenGuard(storage).stuck("p1"), false);
  assert.equal(storage.items.has(OPENING_KEY), false);
});

test("finished clears the mark at once and stops the timer; a newer opening isn't cleared by an older one's timer", () => {
  const storage = fakeStorage();
  const clock = fakeTimers();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("p1");
  guard.finished(); // the store refused p1 with a message, or the page was closed: not a freeze
  assert.equal(storage.items.has(OPENING_KEY), false);
  // p1 shown, then a file opened as p2 before p1 settled: p1's timer must not clear p2's mark.
  guard.opening("p1");
  guard.shown("p1");
  clock.advance(SETTLED_MS / 2);
  guard.opening("p2");
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.get(OPENING_KEY), "p2");
  // And a timer whose mark was replaced by another tab leaves that mark alone.
  guard.shown("p2");
  storage.items.set(OPENING_KEY, "p3");
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.get(OPENING_KEY), "p3");
});

test("opening the same project again restarts its wait: the first showing's timer is stopped", () => {
  // p1 shown at 0, opened again at 1,500 (as Open would with a file) and not
  // yet shown: at 3,000 the first timer would clear the mark of the second
  // opening, which is still under way, so it must have been stopped.
  const storage = fakeStorage();
  const clock = fakeTimers();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("p1");
  guard.shown("p1");
  clock.advance(SETTLED_MS / 2);
  guard.opening("p1");
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  guard.shown("p1");
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.has(OPENING_KEY), false);
});

test("no storage, or storage that throws, never skips and never throws", () => {
  const throwing: MarkStorage = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  for (const storage of [null, throwing]) {
    const clock = fakeTimers();
    const guard = reopenGuard(storage, { timers: clock.timers });
    guard.opening("p1");
    guard.shown("p1");
    clock.advance(SETTLED_MS);
    guard.finished();
    assert.equal(guard.stuck("p1"), false);
  }
});

/** splitmix64, as packages/core's tests use: the same seed gives the same visits. */
function rng(seed: bigint) {
  let s = seed;
  const M = (1n << 64n) - 1n;
  return () => {
    s = (s + 0x9e3779b97f4a7c15n) & M;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M;
    return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53;
  };
}

// "put-away": the phone locked or the app switched (before or after showing), then the tab killed by the OS.
type Outcome = "fine" | "froze-opening" | "froze-shown" | "closed-early" | "refused" | "put-away";
const OUTCOMES: Outcome[] = ["fine", "froze-opening", "froze-shown", "closed-early", "refused", "put-away"];

test("seeded visits against a model: skipped exactly when the visit before froze on that project", () => {
  // The model, written from the rule and not from the guard: a visit skips
  // its newest project iff the visit before tried that same project and
  // froze (before or after showing it, short of SETTLED_MS); a tab put away
  // and then killed didn't freeze, its page ran the put-away. A skipped
  // visit opens nothing, so the next one tries again.
  for (let seed = 1n; seed <= 20n; seed++) {
    const random = rng(seed);
    const storage = fakeStorage();
    let froze: string | null = null; // the project the last visit froze on
    const seen = new Set<string>();
    for (let visit = 0; visit < 200; visit++) {
      const newest = `p${1 + Math.floor(random() * 3)}`;
      const outcome = OUTCOMES[Math.floor(random() * OUTCOMES.length)];
      const clock = fakeTimers();
      const guard = reopenGuard(storage, { timers: clock.timers });
      const skipped = guard.stuck(newest);
      assert.equal(skipped, froze === newest, `seed ${seed}, visit ${visit}: ${newest} after a freeze on ${froze}`);
      seen.add(`${skipped}`);
      froze = null;
      if (skipped) continue;
      guard.opening(newest);
      if (outcome === "froze-opening") froze = newest;
      else if (outcome === "refused") guard.finished();
      else if (outcome === "put-away") {
        if (random() < 0.5) {
          guard.shown(newest);
          clock.advance(SETTLED_MS * random() * 0.99);
        }
        guard.putAway(); // and killed: nothing more runs
      }
      else {
        guard.shown(newest);
        if (outcome === "froze-shown") {
          clock.advance(SETTLED_MS * random() * 0.99);
          froze = newest;
        } else if (outcome === "closed-early") {
          clock.advance(SETTLED_MS * random() * 0.99);
          guard.finished();
        } else clock.advance(SETTLED_MS + random() * 10_000);
      }
    }
    assert.deepEqual([...seen].sort(), ["false", "true"], `seed ${seed} reached both answers`);
  }
});

// ---------- two tabs (real-use hunt A3) ----------
// A second tab started while the first is still opening the same project
// (a restored session, a bookmark clicked twice) found the first tab's mark
// and took it for a freeze. Now it asks over a channel shared by the tabs
// (the browser's BroadcastChannel): a tab still opening it answers, and a
// tab that froze or crashed can't, so only an unanswered mark is a freeze.

/** One BroadcastChannel per tab on a shared bus: a message reaches every other live tab, a moment later. */
function fakeBus() {
  const tabs = new Set<OpeningChannel & { alive: boolean }>();
  const tab = () => {
    const end: OpeningChannel & { alive: boolean } = {
      alive: true,
      onmessage: null,
      postMessage(data) {
        for (const other of tabs)
          if (other !== end && other.alive) queueMicrotask(() => other.alive && other.onmessage?.({ data }));
      },
    };
    tabs.add(end);
    return end;
  };
  return { tab };
}

/** Lets the bus's messages through, then moves the clock on by `ms`. */
async function settle(clock: ReturnType<typeof fakeTimers>, ms: number) {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  clock.advance(ms);
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test("a second tab started while the first is still opening the project opens it too (worked by hand)", async () => {
  const storage = fakeStorage();
  const bus = fakeBus();
  // Tab 1 starts opening p1: its mark names p1.
  const c1 = fakeTimers();
  const t1 = reopenGuard(storage, { timers: c1.timers, channel: bus.tab() });
  assert.equal(await t1.check("p1"), false);
  t1.opening("p1");
  // Tab 2, a moment later, finds the mark; tab 1 answers that it is opening p1, so it is not a freeze.
  const c2 = fakeTimers();
  const t2 = reopenGuard(storage, { timers: c2.timers, channel: bus.tab() });
  const asked = t2.check("p1");
  await settle(c2, 0);
  assert.equal(await asked, false);
  assert.equal(storage.items.get(OPENING_KEY), "p1", "tab 1's mark is left alone");
});

test("a mark no tab answers for is a freeze: skipped once and cleared, after ASK_MS", async () => {
  const storage = fakeStorage();
  const bus = fakeBus();
  const frozen = bus.tab();
  const t1 = reopenGuard(storage, { channel: frozen, timers: fakeTimers().timers });
  t1.opening("p1");
  frozen.alive = false; // the tab froze or crashed: its page runs nothing, so it can't answer
  const c2 = fakeTimers();
  const t2 = reopenGuard(storage, { timers: c2.timers, channel: bus.tab() });
  let answer: boolean | null = null;
  const asked = t2.check("p1").then((a) => (answer = a));
  await settle(c2, ASK_MS - 1);
  assert.equal(answer, null, "still waiting for an answer just before ASK_MS");
  await settle(c2, 1);
  await asked;
  assert.equal(answer, true);
  assert.equal(storage.items.has(OPENING_KEY), false, "cleared, so the visit after tries again");
});

test("an answer counts until ASK_MS: at 0.9× it does, at 1.1× it comes too late", async () => {
  for (const [fraction, stuck] of [[0.9, false], [1.1, true]] as const) {
    const storage = fakeStorage();
    // Tab 1's answers are held by its busy page and sent after `fraction` × ASK_MS.
    const c = fakeTimers();
    const slow: OpeningChannel = { onmessage: null, postMessage: (data) => c.timers.setTimeout(() => t2end.onmessage?.({ data }), fraction * ASK_MS) };
    const t2end: OpeningChannel = { onmessage: null, postMessage: (data) => queueMicrotask(() => slow.onmessage?.({ data })) };
    const t1 = reopenGuard(storage, { timers: c.timers, channel: slow });
    t1.opening("p1");
    const asked = reopenGuard(storage, { timers: c.timers, channel: t2end }).check("p1");
    await settle(c, 2 * ASK_MS);
    assert.equal(await asked, stuck, `${fraction}×`);
  }
  assert.equal(ASK_MS, 1000);
});

test("a tab answers only for the project it is opening, and only until it settles", async () => {
  const storage = fakeStorage();
  const bus = fakeBus();
  const c1 = fakeTimers();
  const t1 = reopenGuard(storage, { timers: c1.timers, channel: bus.tab() });
  t1.opening("p1");
  t1.shown("p1");
  c1.advance(SETTLED_MS); // settled: tab 1 no longer counts as opening p1
  storage.items.set(OPENING_KEY, "p1"); // a later visit froze on p1 while tab 1 stays open
  const c2 = fakeTimers();
  const asked = reopenGuard(storage, { timers: c2.timers, channel: bus.tab() }).check("p1");
  await settle(c2, ASK_MS);
  assert.equal(await asked, true, "tab 1 settled long ago, so it doesn't answer");
  // A tab opening p2 doesn't answer for p1.
  const c3 = fakeTimers();
  reopenGuard(storage, { timers: c3.timers, channel: bus.tab() }).opening("p2");
  storage.items.set(OPENING_KEY, "p1");
  const c4 = fakeTimers();
  const again = reopenGuard(storage, { timers: c4.timers, channel: bus.tab() }).check("p1");
  await settle(c4, ASK_MS);
  assert.equal(await again, true);
});

test("check without a mark naming the project answers at once, without asking", async () => {
  const storage = fakeStorage();
  let posted = 0;
  const guard = reopenGuard(storage, { timers: fakeTimers().timers, channel: { onmessage: null, postMessage: () => void posted++ } });
  assert.equal(await guard.check("p1"), false);
  storage.items.set(OPENING_KEY, "p2");
  assert.equal(await guard.check("p1"), false);
  assert.equal(posted, 0);
  assert.equal(storage.items.has(OPENING_KEY), false, "a mark for another project is cleared, as stuck() does");
});

test("a tab closing doesn't clear another tab's mark, only its own", () => {
  // pagehide calls finished() in every tab that closes; one closing while another is opening must leave that mark.
  const storage = fakeStorage();
  const t1 = reopenGuard(storage, { timers: fakeTimers().timers });
  const t2 = reopenGuard(storage, { timers: fakeTimers().timers });
  t1.opening("p1");
  t2.finished(); // tab 2 never opened anything and is closed
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  t2.opening("p1"); // both opening p1; tab 2 is closed normally
  t2.finished();
  assert.equal(storage.items.has(OPENING_KEY), false, "the mark named the project tab 2 was opening");
});

test("seeded two-tab visits against a model: skipped exactly when the mark has no live tab opening it", async () => {
  // The model: a tab starting finds the newest project p. It is skipped iff
  // the mark names p and no live tab is still opening p (one that froze or
  // closed doesn't count). Tabs start, open, show, settle, freeze and close
  // at random; at most two are open at once.
  for (let seed = 1n; seed <= 20n; seed++) {
    const random = rng(seed);
    const storage = fakeStorage();
    const bus = fakeBus();
    type Tab = { guard: ReturnType<typeof reopenGuard>; clock: ReturnType<typeof fakeTimers>; end: ReturnType<ReturnType<typeof fakeBus>["tab"]>; opening: string | null; frozen: boolean };
    let tabs: Tab[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < 400; step++) {
      const live = tabs.filter((t) => !t.frozen);
      const roll = random();
      if (tabs.length < 2 && roll < 0.4) {
        const p = `p${1 + Math.floor(random() * 2)}`;
        const mark = storage.items.get(OPENING_KEY) ?? null;
        const expected = mark === p && !live.some((t) => t.opening === p);
        const clock = fakeTimers();
        const end = bus.tab();
        const guard = reopenGuard(storage, { timers: clock.timers, channel: end });
        const asked = guard.check(p);
        await settle(clock, ASK_MS);
        const skipped = await asked;
        assert.equal(skipped, expected, `seed ${seed}, step ${step}: ${p}, mark ${mark}, opening ${live.map((t) => t.opening)}`);
        seen.add(`${skipped}`);
        const tab: Tab = { guard, clock, end, opening: null, frozen: false };
        if (!skipped) {
          guard.opening(p);
          tab.opening = p;
        }
        tabs.push(tab);
      } else if (tabs.length > 0) {
        const tab = tabs[Math.floor(random() * tabs.length)];
        if (tab.frozen || roll < 0.55) {
          // Closed: normally (pagehide) unless frozen, which a tab killed by the browser never gets to run.
          if (!tab.frozen) tab.guard.finished();
          tab.end.alive = false;
          tabs = tabs.filter((t) => t !== tab);
        } else if (roll < 0.7) {
          tab.frozen = true;
          tab.end.alive = false;
        } else if (tab.opening) {
          // Shown, and settled once SETTLED_MS passes.
          tab.guard.shown(tab.opening);
          const p = tab.opening;
          tab.clock.advance(SETTLED_MS);
          if (tab.opening === p) tab.opening = null;
        }
      }
    }
    assert.deepEqual([...seen].sort(), ["false", "true"], `seed ${seed} reached both answers`);
  }
});

// ---------- put away (real-use hunt D1) ----------
// A phone locked or the app switched soon after the project shows: the OS
// freezes the tab, and may kill it later with no pagehide and no timer run,
// which left the mark as if the project had frozen the tab. A tab that runs
// its put-away handler isn't hung, so its mark goes then, and comes back if
// it is brought back while still opening.

test("put away after showing: the mark goes at once, and the settle timer with it (worked by hand)", () => {
  const storage = fakeStorage();
  const clock = fakeTimers();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("p1");
  guard.shown("p1");
  clock.advance(500); // locked 0.5 s after showing, well inside SETTLED_MS
  guard.putAway();
  assert.equal(storage.items.has(OPENING_KEY), false, "a killed tab leaves no mark");
  // Back again: shown already, so nothing comes back; the next visit opens p1.
  guard.back();
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.has(OPENING_KEY), false);
  assert.equal(reopenGuard(storage).stuck("p1"), false);
});

test("put away while still opening: the mark goes, and comes back with the tab, until it settles", () => {
  const storage = fakeStorage();
  const clock = fakeTimers();
  const guard = reopenGuard(storage, { timers: clock.timers });
  guard.opening("p1");
  guard.putAway();
  assert.equal(storage.items.has(OPENING_KEY), false);
  guard.back(); // still opening: a freeze from here on must still be caught
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  guard.shown("p1");
  clock.advance(SETTLED_MS);
  assert.equal(storage.items.has(OPENING_KEY), false);
  guard.back(); // settled: nothing to put back
  assert.equal(storage.items.has(OPENING_KEY), false);
});

test("put away leaves another tab's mark alone, and a tab with nothing opening writes nothing", () => {
  const storage = fakeStorage();
  const t1 = reopenGuard(storage, { timers: fakeTimers().timers });
  const t2 = reopenGuard(storage, { timers: fakeTimers().timers });
  t1.opening("p1");
  t2.putAway();
  t2.back();
  assert.equal(storage.items.get(OPENING_KEY), "p1");
  t1.finished();
  t2.back();
  assert.equal(storage.items.has(OPENING_KEY), false);
});
