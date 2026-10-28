// Offline mode: registers the service worker (sw.js, written into the built
// app by offline.mjs), which keeps the app and its kernel so it opens with no
// connection. A new version installs in the background and waits; this
// shows "A new version of SpindleLabs is ready" with Reload, which tells the
// waiting worker to take over and reloads once it has, so the page and
// the kernel always come from one build. A tab still on the old version
// when another tab updates says so too. Only in the built app (the dev
// server has no sw.js), and never in a frame: main.ts imports this after
// frame-guard.ts, which stops a framed page first.
import "./styles/app-update.css";

type Shown = "ready" | "elsewhere";

const WORDS: Record<Shown, string> = {
  ready: "A new version of SpindleLabs is ready.",
  elsewhere: "SpindleLabs was updated in another tab.",
};

/** Shows the update notice (one at a time) with its Reload button. */
function showNotice(kind: Shown, reload: () => void) {
  document.getElementById("app-update")?.remove();
  const box = Object.assign(document.createElement("div"), { id: "app-update", className: "app-update" });
  box.setAttribute("role", "status");
  box.dataset.kind = kind;
  const words = Object.assign(document.createElement("span"), { textContent: WORDS[kind] });
  const button = Object.assign(document.createElement("button"), { type: "button", id: "app-update-reload", textContent: "Reload" });
  button.title = "Reload to use the new version; your design is kept";
  button.addEventListener("click", () => {
    button.disabled = true;
    reload();
  });
  box.append(words, button);
  document.body.append(box);
}

export function startOffline() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  let updating = false; // this tab pressed Reload
  const hadController = sw.controller !== null;
  sw.addEventListener("controllerchange", () => {
    if (updating) location.reload();
    // The first install takes no page over, so a change here means a new
    // version took over from another tab (or every other tab closed).
    else if (hadController) showNotice("elsewhere", () => location.reload());
  });
  const offer = (waiting: ServiceWorker) =>
    showNotice("ready", () => {
      updating = true;
      waiting.postMessage({ type: "skip-waiting" });
    });
  sw.register("./sw.js", { scope: "./" })
    .then((reg) => {
      // A version already waiting (found on an earlier visit), one still
      // installing (the browser may have started looking before this ran),
      // or one found by the look below or later.
      const follow = (next: ServiceWorker | null) =>
        next?.addEventListener("statechange", () => {
          if (next.state === "installed" && sw.controller) offer(next);
        });
      if (reg.waiting && sw.controller) offer(reg.waiting);
      else follow(reg.installing);
      reg.addEventListener("updatefound", () => follow(reg.installing));
      // Look for a new sw.js on every page load (one small request; browsers
      // don't always look on a reload), and again on coming back online.
      const look = () => void reg.update().catch(() => {}); // offline: nothing to find
      look();
      addEventListener("online", look);
    })
    .catch(() => {}); // no service workers here (blocked, private mode): the app works as before, online only
}
