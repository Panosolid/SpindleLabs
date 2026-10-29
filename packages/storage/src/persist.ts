// Asks the browser to keep the store (navigator.storage.persist), so projects
// aren't cleared when the device runs low on space (real-use hunt B3). Asked
// once, by the app after the first save of the user's own work rather than on
// load: Chromium and Safari answer without asking the user, and Firefox's
// question then comes when there is work to keep. Whatever the answer, saving
// goes on as before.

/** The part of the browser's StorageManager used here; absent where the browser has none. */
export interface PersistentStorage {
  persist?: () => Promise<boolean>;
}

/** A function to call after each save: the first call asks the browser, every later one does nothing. */
export function keepStorage(storage: PersistentStorage | undefined): () => void {
  let asked = false;
  return () => {
    if (asked) return;
    asked = true;
    try {
      void storage?.persist?.().catch(() => {});
    } catch {
      // a browser that refuses to be asked: the store is kept as before, best effort
    }
  };
}
