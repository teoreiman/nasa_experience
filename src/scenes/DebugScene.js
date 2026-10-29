// Developer test harness: /?debug=<name>&k=v loads src/debug/<name>.js, whose default export is
//   async (game, params) => ({ update(dt), render(), resize?(w, h), dispose?() })
// Every agent can add its own debug views (unique file names) to test components in isolation.

const views = import.meta.glob('../debug/*.js');

export default class DebugScene {
  constructor(game) {
    this.game = game;
    this.impl = null;
  }

  async enter({ name, params = {} }) {
    const loader = views[`../debug/${name}.js`];
    if (!loader) throw new Error(`Vista de depuración desconocida: ${name}. Disponibles: ${Object.keys(views).join(', ')}`);
    const mod = await loader();
    this.impl = await mod.default(this.game, params);
  }

  update(dt) {
    this.impl?.update?.(dt);
  }

  render() {
    this.impl?.render?.();
  }

  resize(w, h) {
    this.impl?.resize?.(w, h);
  }

  exit() {
    this.impl?.dispose?.();
  }
}
