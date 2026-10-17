// Environnement navigateur minimal : les modules du site tournent sous Node
// pour les tests (stockage, langue, origine). Importé en premier.
if (!globalThis.window) globalThis.window = {}
// La page charge toujours public/config.js avant les modules : le shim fait
// pareil, sans quoi chaque exécution avertirait d'une config absente.
globalThis.window.TU_CONFIG ??= { apiUrl: 'same-origin' }
if (!globalThis.navigator) {
  globalThis.navigator = {
    userAgent: 'node-test',
    language: 'en-US',
    languages: ['en-US'],
    platform: 'node',
    maxTouchPoints: 0,
  }
}
if (!globalThis.location) {
  globalThis.location = { origin: 'http://localhost', pathname: '/', search: '', hash: '' }
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
