// Entry point: fonts, styles, game shell, scenes and URL routing.
//   /                                   → menu (role → mission → chapter every start)
//   /?play=a11-landing&role=controller  → jump straight into a chapter
//   /?scene=hangar                      → any registered scene
//   /?debug=<name>&k=v                  → developer harness (src/debug/<name>.js)

import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/share-tech-mono/400.css';
import './styles/base.css';
import './styles/ui.css';

import { Game } from './core/Game.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { store } from './core/Store.js';

const game = new Game({ canvas: document.getElementById('gl'), uiRoot: document.getElementById('ui') });
game.audio = new AudioEngine(game);
window.__game = game;

const unlockAudio = () => game.audio.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

game.registerScene('menu', () => import('./scenes/MenuScene.js'));
game.registerScene('briefing', () => import('./scenes/BriefingScene.js'));
game.registerScene('play', () => import('./scenes/PlayScene.js'));
game.registerScene('eva', () => import('./eva/EVAScene.js'));
game.registerScene('debrief', () => import('./scenes/DebriefScene.js'));
game.registerScene('debug', () => import('./scenes/DebugScene.js'));
const optionalScenes = import.meta.glob('./scenes/{Hangar,Archive,Credits}Scene.js');
for (const [path, loader] of Object.entries(optionalScenes)) {
  const name = path.match(/\/(\w+)Scene\.js$/)[1].toLowerCase();
  game.registerScene(name, loader);
}

async function boot() {
  await document.fonts?.ready;
  const q = new URLSearchParams(location.search);
  game.start();
  if (q.has('play')) {
    const role = q.get('role') === 'controller' ? 'controller' : 'astronaut';
    store.session.role = role;
    const chapterId = q.get('play');
    await game.goto(chapterId === 'a11-eva' ? 'eva' : 'play', { chapterId, role });
  } else if (q.has('debug')) {
    await game.goto('debug', { name: q.get('debug'), params: Object.fromEntries(q) });
  } else if (q.has('scene')) {
    await game.goto(q.get('scene'), Object.fromEntries(q));
  } else {
    await game.goto('menu', {});
  }
  window.__APOLO_READY__ = true;
}

boot().catch((err) => {
  console.error(err);
  game.showError(err);
});
