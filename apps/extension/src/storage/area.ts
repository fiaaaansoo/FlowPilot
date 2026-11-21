/**
 * Abstraction minimale d'une zone de stockage clé/valeur. Permet de tester les
 * stores sans Chrome (implémentation mémoire) et de garder l'API Chrome
 * confinée à `chromeArea`.
 */
export interface KeyValueArea {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function chromeArea(area: chrome.storage.StorageArea): KeyValueArea {
  return {
    async get(key) {
      const items = await area.get(key);
      return items[key];
    },
    set: (key, value) => area.set({ [key]: value }),
    remove: (key) => area.remove(key),
  };
}

export function memoryArea(initial: Record<string, unknown> = {}): KeyValueArea {
  const data = new Map<string, unknown>(Object.entries(initial));
  // Copie profonde : simule la sérialisation de chrome.storage (pas de référence partagée).
  const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));
  return {
    get: (key) => Promise.resolve(clone(data.get(key))),
    set: (key, value) => {
      data.set(key, clone(value));
      return Promise.resolve();
    },
    remove: (key) => {
      data.delete(key);
      return Promise.resolve();
    },
  };
}
