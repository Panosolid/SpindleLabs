// Skeleton placeholders (Ben's ask, 10-29: "a modern skeleton loading thing
// like Instagram"): soft shimmering shapes where something is still loading,
// in the shape of what will be there. They never flash: a skeleton stays
// invisible for its first SKELETON_DELAY_MS (styles/skeleton.css holds it at
// opacity 0, so a fast load shows nothing at all), and one taken away after
// it showed fades out over SKELETON_FADE_MS; one taken away sooner goes at
// once. Under prefers-reduced-motion the shapes are still and the fades
// instant. `skeleton` builds the shapes, `holdSkeleton` puts one in a host
// until it is done, `adoptSkeleton` takes over one already in the page
// (index.html's, there before any script runs), and `leaveAfter` is the
// rule for how long one takes to go, tested by hand.

/** How long a skeleton stays invisible: a load quicker than this never shows one. Mirrored in styles/skeleton.css. */
export const SKELETON_DELAY_MS = 200;
/** How long a skeleton that showed takes to fade out. Mirrored in styles/skeleton.css. */
export const SKELETON_FADE_MS = 160;

/**
 * The shapes: `app` the whole workspace (toolbar, browser rows, the view),
 * `view` a 3D view being filled, `lines` a few lines of words being written.
 */
export type SkeletonShape = "app" | "view" | "lines";

/**
 * How long, in ms, a skeleton put up `elapsed` ms ago takes to go once it
 * is done: 0 while it has not yet shown (it never appears), else the fade.
 */
export function leaveAfter(elapsed: number, delay = SKELETON_DELAY_MS, fade = SKELETON_FADE_MS): number {
  return elapsed < delay ? 0 : fade;
}

const bone = (doc: Document, ...kinds: string[]) => {
  const b = doc.createElement("span");
  b.className = ["skeleton-bone", ...kinds.map((k) => `skeleton-${k}`)].join(" ");
  return b;
};
const group = (doc: Document, kind: string, ...children: HTMLElement[]) => {
  const g = doc.createElement("div");
  g.className = `skeleton-${kind}`;
  g.append(...children);
  return g;
};

/** The skeleton element for `shape`, read out as `label` (a status, so a screen reader hears "Loading…" once). */
export function skeleton(doc: Document, shape: SkeletonShape, label = "Loading…"): HTMLElement {
  const el = doc.createElement("div");
  el.className = `skeleton skeleton-${shape}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", label);
  if (shape === "lines") {
    el.append(bone(doc, "line"), bone(doc, "line"), bone(doc, "line", "short"));
  } else if (shape === "view") {
    el.append(bone(doc, "cube"), bone(doc, "card"), bone(doc, "pill"));
  } else {
    const tools = Array.from({ length: 3 }, () => group(doc, "tool-group", bone(doc, "tool"), bone(doc, "tool"), bone(doc, "tool"), bone(doc, "tool-name")));
    const rows = Array.from({ length: 5 }, (_, i) => bone(doc, "row", ...(i % 2 ? ["row-short"] : [])));
    el.append(group(doc, "toolbar", ...tools), group(doc, "browser", bone(doc, "heading"), ...rows), group(doc, "view", bone(doc, "cube"), bone(doc, "card"), bone(doc, "pill")));
  }
  return el;
}

export interface HeldSkeleton {
  readonly element: HTMLElement;
  /** Takes it away (faded if it showed); resolves once it is gone. Calling it again does nothing more. */
  done(): Promise<void>;
}

/**
 * Takes over `element`, a skeleton already in the page that started
 * showing at `since` (ms on `now`'s clock; index.html's started with the
 * page, 0 on performance.now()).
 */
export function adoptSkeleton(element: HTMLElement, since = 0, now: () => number = () => performance.now()): HeldSkeleton {
  const host = element.parentElement;
  host?.setAttribute("aria-busy", "true");
  let gone: Promise<void> | null = null;
  return {
    element,
    done() {
      gone ??= new Promise<void>((resolve) => {
        const wait = leaveAfter(now() - since);
        const remove = () => {
          element.remove();
          if (host && !host.querySelector(":scope > .skeleton")) host.removeAttribute("aria-busy");
          resolve();
        };
        if (wait === 0) return remove();
        element.classList.add("skeleton-leaving");
        setTimeout(remove, wait);
      });
      return gone;
    },
  };
}

/** A skeleton of `shape` put in `host` now, until `done`. */
export function holdSkeleton(host: HTMLElement, shape: SkeletonShape, label?: string, now: () => number = () => performance.now()): HeldSkeleton {
  const el = skeleton(host.ownerDocument, shape, label);
  host.append(el);
  return adoptSkeleton(el, now(), now);
}

/** Shows a skeleton of `shape` in `host` while `work` runs (if it runs long enough to be seen), and gives back its result. */
export async function whileLoading<T>(host: HTMLElement, shape: SkeletonShape, work: Promise<T>, label?: string): Promise<T> {
  const held = holdSkeleton(host, shape, label);
  try {
    return await work;
  } finally {
    void held.done();
  }
}
