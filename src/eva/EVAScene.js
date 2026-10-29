// Lunar surface EVA scene (first-person helmet view, optional third person). STUB by the
// architect; the "bonus" agent implements it. Same chapter/runner contract as PlayScene:
//   enter({ chapterId, role }) — runs the chapter's run(ctx) with a Simulation whose dynamics mode
//   is 'LANDED'; ctx.view is the EVA view facade.

import PlayScene from '../scenes/PlayScene.js';

export default class EVAScene extends PlayScene {}
