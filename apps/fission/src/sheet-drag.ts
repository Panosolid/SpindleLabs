// At phone width the Browser, Properties and the AI panel are sheets over the
// view (styles/phone-sheet.css), each with a grab handle. A finger dragging
// the handle down, or dragging down on a sheet already scrolled to its top,
// moves the whole sheet with it, and letting go far enough down (or with a
// flick) puts the sheet away; not far enough and it slides back. Before this
// a drag only scrolled the sheet's words, so on an iPhone the handle bounced
// with them and the sheet never closed (Ben, 2026-10-29).

/** The sheets a drag can close. */
export const SHEETS = "#browser, #properties, #assistant";
/** How far below a sheet's top edge a touch still takes the handle (the handle sits 8 px down, in the sheet's 22 px top padding). */
export const GRAB_ZONE = 32;
/** How far a finger moves before the drag is the sheet's and not a tap (px). */
export const SLOP = 6;
/** A release this far down always closes the sheet (px)… */
export const CLOSE_DISTANCE = 120;
/** …as does one past this share of the sheet's height, for a short sheet… */
export const CLOSE_SHARE = 0.25;
/** …or a downward flick at least this fast (px per ms) that moved past the slop. */
export const CLOSE_SPEED = 0.5;

/**
 * Whether letting go of a sheet dragged `dy` px down (from where the
 * finger started), `height` px tall, moving at `speed` px/ms when let go
 * (down is positive), closes it.
 */
export function closesOnRelease(dy: number, height: number, speed: number): boolean {
  if (!(dy > SLOP)) return false;
  return dy >= Math.min(CLOSE_DISTANCE, height * CLOSE_SHARE) || speed >= CLOSE_SPEED;
}

/**
 * Watches touches (and a mouse or pen on the handle) on the sheets in
 * `root`; `close(sheet)` puts one away. Only while `phone` matches: on a wide
 * screen the panels are not sheets.
 */
export function sheetDrag(root: Document, phone: MediaQueryList, close: (sheet: HTMLElement) => void): void {
  const view = root.defaultView;
  interface Drag {
    sheet: HTMLElement;
    x: number;
    y: number;
    /** The touch started on the handle (or the sheet was at its top), so a move down drags the sheet. */
    grab: boolean;
    /** null until the finger moved past the slop or the first move decided; then whether the sheet follows. */
    dragging: boolean | null;
    dy: number;
    lastY: number;
    lastT: number;
    speed: number;
  }
  let drag: Drag | null = null;
  const sheetAt = (target: EventTarget | null): HTMLElement | null => {
    if (!phone.matches || !(target instanceof Element)) return null;
    const sheet = target.closest<HTMLElement>(SHEETS);
    return sheet && sheet.closest("#workspace") && view?.getComputedStyle(sheet).position === "absolute" ? sheet : null;
  };
  const begin = (sheet: HTMLElement, x: number, y: number, t: number, handleOnly: boolean) => {
    const top = sheet.getBoundingClientRect().top;
    const onHandle = y - top <= GRAB_ZONE;
    if (handleOnly && !onHandle) return;
    drag = { sheet, x, y, grab: onHandle || sheet.scrollTop <= 0, dragging: null, dy: 0, lastY: y, lastT: t, speed: 0 };
  };
  /** Follows the finger; returns whether the sheet took the move (so the page must not scroll). */
  const move = (x: number, y: number, t: number): boolean => {
    if (!drag) return false;
    const dx = x - drag.x;
    const dy = y - drag.y;
    if (drag.dragging === null) {
      // Decided on the first move: Safari scrolls for the rest of the touch unless the first move is stopped.
      if (!drag.grab || dy < 0 || Math.abs(dx) > SLOP) drag.dragging = false; // scrolling the words, or sideways
      else if (dy > 0 && dy >= Math.abs(dx)) drag.dragging = true;
      if (!drag.dragging) return false;
      drag.sheet.style.transition = "none";
      drag.sheet.dataset.dragging = "";
    }
    if (!drag.dragging) return false;
    drag.dy = Math.max(0, dy);
    if (t > drag.lastT) drag.speed = (y - drag.lastY) / (t - drag.lastT);
    drag.lastY = y;
    drag.lastT = t;
    drag.sheet.style.transform = `translateY(${drag.dy}px)`;
    return true;
  };
  const end = () => {
    const d = drag;
    drag = null;
    if (!d || !d.dragging) return;
    const { sheet } = d;
    delete sheet.dataset.dragging;
    const reset = () => {
      sheet.style.transition = "";
      sheet.style.transform = "";
    };
    const still = view?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? true;
    if (closesOnRelease(d.dy, sheet.getBoundingClientRect().height, d.speed)) {
      if (still) {
        close(sheet);
        reset();
        return;
      }
      // Slides the rest of the way out, then is put away.
      sheet.style.transition = "transform 140ms ease-in";
      sheet.style.transform = `translateY(${sheet.getBoundingClientRect().height + d.dy}px)`;
      view?.setTimeout(() => {
        close(sheet);
        reset();
      }, 140);
    } else if (still) reset();
    else {
      sheet.style.transition = "transform 160ms ease-out";
      sheet.style.transform = "";
      view?.setTimeout(reset, 160);
    }
  };
  root.addEventListener("touchstart", (e) => {
    drag = null;
    const sheet = e.touches.length === 1 ? sheetAt(e.target) : null;
    if (sheet) begin(sheet, e.touches[0].clientX, e.touches[0].clientY, e.timeStamp, false);
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (!drag) return;
    if (e.touches.length !== 1) {
      end();
      return;
    }
    if (move(e.touches[0].clientX, e.touches[0].clientY, e.timeStamp) && e.cancelable) e.preventDefault();
  }, { passive: false });
  root.addEventListener("touchend", end);
  root.addEventListener("touchcancel", end);
  // A mouse or pen (a narrow desktop window) drags by the handle only: in the words it selects text.
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button !== 0) return;
    const sheet = sheetAt(e.target);
    if (sheet) begin(sheet, e.clientX, e.clientY, e.timeStamp, true);
  });
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "touch" && drag && move(e.clientX, e.clientY, e.timeStamp)) e.preventDefault();
  });
  root.addEventListener("pointerup", (e) => e.pointerType !== "touch" && end());
  root.addEventListener("pointercancel", (e) => e.pointerType !== "touch" && end());
}
