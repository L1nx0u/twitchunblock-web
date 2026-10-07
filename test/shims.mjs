// Environnement navigateur minimal : les modules du site tournent sous Node
// pour les tests (stockage, langue, origine). Importé en premier.
if (!globalThis.window) globalThis.window = {}
if (!globalThis.navigator) {
  globalThis.navigator = {
    userAgent: 'node-test',
    language: 'en-US',
    languages: ['en-US'],
    platform: 'node',
    maxTouchPoints: 0,
  }
}
if (!globalThis.localStorage) {
  const data = new Map()
  globalThis.localStorage = {
    getItem: (k) => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => { data.set(String(k), String(v)) },
    removeItem: (k) => { data.delete(String(k)) },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size },
  }
}
