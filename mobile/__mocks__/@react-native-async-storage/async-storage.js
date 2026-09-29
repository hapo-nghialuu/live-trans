const store = new Map();

module.exports = {
  __esModule: true,
  default: {
    getItem: async key => store.get(key) ?? null,
    setItem: async (key, value) => { store.set(key, String(value)); },
    removeItem: async key => { store.delete(key); },
    clear: async () => { store.clear(); },
  },
};
