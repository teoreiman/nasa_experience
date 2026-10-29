// Minimal synchronous pub/sub. The game owns a global bus (game.bus) and every PlayScene owns a
// simulation bus (sim.bus) that is cleared when the scene ends, so module listeners never leak.

export class EventBus {
  constructor() {
    this._handlers = new Map();
  }

  /** @returns {() => void} unsubscribe */
  on(type, fn) {
    let set = this._handlers.get(type);
    if (!set) this._handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this._handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._handlers.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[bus] handler for "${type}" failed`, err);
        }
      }
    }
    const any = this._handlers.get('*');
    if (any) for (const fn of [...any]) fn(type, payload);
  }

  clear() {
    this._handlers.clear();
  }
}
