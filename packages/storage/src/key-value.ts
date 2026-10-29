// The small key-value interface the project store is written over. The
// browser uses IndexedDB through a thin adapter (indexeddb.ts); unit tests
// use the in-memory one below, so the store's logic is tested without a
// browser.

export interface KeyValue {
  /** The value under `key`, or undefined when there is none. */
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  /** Removes `key`; removing a key that is not there does nothing. */
  delete(key: string): Promise<void>;
  /** Every key that starts with `prefix`, in no particular order. */
  keys(prefix: string): Promise<string[]>;
  /**
   * Reads `keys`, then writes what `change` returns for them, as one step: no other write (from this tab or another)
   * lands between the read and the writes, and either every write lands or none does. `change` runs synchronously;
   * when it throws, nothing is written and the promise rejects with what it threw (real-use hunt B6, B7).
   */
  update(keys: readonly string[], change: (values: (string | undefined)[]) => Record<string, string>): Promise<void>;
}

/** A key-value store held in memory: for tests, and gone when the page closes. */
export function memoryKeyValue(): KeyValue & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    get: async (key) => entries.get(key),
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    keys: async (prefix) => [...entries.keys()].filter((k) => k.startsWith(prefix)),
    update: async (keys, change) => {
      // Read, change and written with no await between: nothing else runs in between.
      const writes = Object.entries(change(keys.map((k) => entries.get(k))));
      for (const [k, v] of writes) entries.set(k, v);
    },
  };
}
