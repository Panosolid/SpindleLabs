// The browser's KeyValue: one IndexedDB database with one object store of
// string keys and string values. Kept thin on purpose; everything worth
// testing lives in store.ts, which the unit tests run on memoryKeyValue.

import type { KeyValue } from "./key-value.ts";

const STORE = "kv";

/** Turns an IndexedDB failure into an Error with a message a person can read. */
function failure(e: DOMException | null, doing: string): Error {
  if (e?.name === "QuotaExceededError") return new Error(`browser storage is full: can't ${doing} (use Save to keep your work as a file)`);
  return new Error(`browser storage failed: can't ${doing}${e ? ` (${e.name}: ${e.message})` : ""}`);
}

function request<T>(r: IDBRequest<T>, doing: string): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(failure(r.error, doing));
  });
}

/**
 * The KeyValue kept in this browser's IndexedDB database `name`. A browser
 * without IndexedDB (some private modes) still gets a KeyValue, whose every
 * call is refused with a message, so the app around it keeps working.
 */
export function indexedDbKeyValue(name = "fission", factory: IDBFactory | undefined = globalThis.indexedDB): KeyValue {
  let db: Promise<IDBDatabase> | undefined;
  let promise: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= promise = new Promise((resolve, reject) => {
      if (!factory) return reject(new Error("IndexedDB is not available"));
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => {
        // The browser closing the database (site data cleared) or another page deleting it: let it go, and open it
        // afresh on the next call instead of failing every call after (real-use hunt B4).
        const opened = r.result;
        const forget = () => {
          if (db === promise) db = undefined;
        };
        opened.onclose = forget;
        opened.onversionchange = () => {
          opened.close();
          forget();
        };
        resolve(opened);
      };
      r.onerror = () => {
        db = undefined; // let the next call try again
        reject(failure(r.error, "open the project database"));
      };
      r.onblocked = () => reject(new Error("browser storage is busy: close other SpindleLabs tabs and try again"));
    }));
  /** A transaction on the store; a connection the browser is closing is let go, and the failure said in words. */
  const transaction = (opened: IDBDatabase, mode: IDBTransactionMode, doing: string) => {
    try {
      return opened.transaction(STORE, mode);
    } catch (e) {
      db = undefined; // the next call opens the database afresh
      throw failure(e instanceof DOMException ? e : null, doing);
    }
  };
  /** Runs one request in its own transaction; a write resolves only once it is committed. */
  const run = async <T>(mode: IDBTransactionMode, doing: string, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const tx = transaction(await open(), mode, doing);
    const result = request(make(tx.objectStore(STORE)), doing);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(failure(tx.error, doing));
      tx.onabort = () => reject(failure(tx.error, doing));
    });
    const [value] = await Promise.all([result, done]);
    return value;
  };
  /** KeyValue.update: the reads, `change` and the writes in one readwrite transaction, which IndexedDB runs alone among those touching this store, in every tab. */
  const update: KeyValue["update"] = async (keys, change) => {
    let doing = `save "${keys.join('", "')}"`;
    const tx = transaction(await open(), "readwrite", doing);
    const store = tx.objectStore(STORE);
    const values: (string | undefined)[] = [];
    let thrown: { error: unknown } | null = null;
    // Each write's own outcome counts too, as in run(): a write refused is a failed save even if the transaction reports complete.
    let written: (writes: Promise<unknown>[]) => void = () => {};
    const writes = new Promise<unknown[]>((resolve) => (written = (all) => resolve(Promise.all(all))));
    // Nothing awaited from here to the writes: a transaction left with no request waiting commits.
    const write = () => {
      const puts: Promise<unknown>[] = [];
      try {
        const changes = Object.entries(change(values));
        if (changes.length > 0) doing = `save "${changes.map(([k]) => k).join('", "')}"`; // a refusal names what was being written
        for (const [k, v] of changes) puts.push(request(store.put(v, k), doing));
        written(puts);
      } catch (error) {
        try {
          thrown = { error };
          tx.abort();
          written([]); // the abort's own error, not the writes it cancelled
        } catch {
          // Already aborted (a put that failed, such as a full disk): its own error is the one to report.
          thrown = null;
          written(puts);
        }
      }
    };
    let left = keys.length;
    keys.forEach((k, i) => {
      const r = store.get(k);
      r.onsuccess = () => {
        values[i] = typeof r.result === "string" ? r.result : undefined;
        if (--left === 0) write();
      };
    });
    if (keys.length === 0) write();
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(thrown ? thrown.error : failure(tx.error, doing));
    });
    await Promise.all([done, writes]);
  };
  return {
    update,
    get: async (key) => {
      const v = await run("readonly", `read "${key}"`, (s) => s.get(key));
      return typeof v === "string" ? v : undefined;
    },
    set: (key, value) => run("readwrite", `save "${key}"`, (s) => s.put(value, key)).then(() => undefined),
    delete: (key) => run("readwrite", `remove "${key}"`, (s) => s.delete(key)).then(() => undefined),
    keys: async (prefix) => {
      // Every string starting with prefix sorts between prefix and prefix + U+FFFF.
      const keys = await run("readonly", "list projects", (s) => s.getAllKeys(IDBKeyRange.bound(prefix, prefix + "￿")));
      return keys.filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
    },
  };
}
