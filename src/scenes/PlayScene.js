// PlayScene: runs one chapter. Owns the Simulation, the primary view (astronaut: FlightView with
// first-person cockpit; controller: MOCRView, first-person Mission Control), the HUD, the sim audio
// director and the MissionRunner. In controller mode the player can toggle (T) to a secondary
// "spacecraft TV" FlightView in observer mode (exterior cameras only).

import { Simulation } from '../sim/Simulation.js';
import { MissionRunner } from '../missions/MissionRunner.js';
import { loadChapter, chapterScene } from '../missions/registry.js';
import { store } from '../core/Store.js';

export default class PlayScene {
  constructor(game) {
    this.game = game;
    this.paused = false;
    this.ending = false;
    this.secondary = null;
    this.showingSecondary = false;
  }

  async enter({ chapterId, role = store.session.role ?? 'astronaut' }) {
    const game = this.game;
    this.role = role;
    store.session.role = role;
    store.session.chapterId = chapterId;
    const { mission, chapter } = await loadChapter(chapterId);
    this.mission = mission;
    this.chapter = chapter;
    store.session.missionId = mission.id;

    const sim = (this.sim = new Simulation({ chapter, missionId: mission.id, role, difficulty: store.settings.difficulty }));
    await sim.init();

    const ViewClass =
      role === 'controller'
        ? (await import('../mocr/MOCRView.js')).MOCRView
        : (await import('../render/FlightView.js')).FlightView;
    this.view = new ViewClass({ game, sim, role, chapter, mission });
    await this.view.init();
    this.view.setActive?.(true);

    const { HUD } = await import('../ui/HUD.js');
    this.hud = new HUD({
      game,
      sim,
      view: this.view,
      role,
      chapter,
      mission,
      actions: {
        resume: () => this.setPaused(false),
        restart: () => game.goto(chapterScene(chapterId), { chapterId, role }),
        quit: () => game.goto('menu', { screen: 'missions' }),
        toggleView: () => this.toggleSecondaryView(),
      },
    });

    const { SimAudio } = await import('../audio/SimAudio.js');
    this.simAudio = new SimAudio({ game, sim, view: this.view, role });

    this.runner = new MissionRunner({ game, sim, view: this.view, chapter, mission, role });
    sim.runner = this.runner;
    sim.bus.on('mission:end', (result) => this._onEnd(result));
    this.runner.start();
    game.audio?.music?.(null);
  }

  get activeView() {
    return this.showingSecondary && this.secondary ? this.secondary : this.view;
  }

  setPaused(p) {
    if (this.ending) return;
    this.paused = p;
    this.sim.clock.paused = p;
    this.hud?.setPaused?.(p);
    if (p) this.game.input.exitPointerLock();
    this.game.audio?.setPaused?.(p);
  }

  async toggleSecondaryView() {
    if (this.role !== 'controller') return;
    if (!this.secondary) {
      const { FlightView } = await import('../render/FlightView.js');
      this.secondary = new FlightView({ game: this.game, sim: this.sim, role: this.role, chapter: this.chapter, mission: this.mission, observer: true });
      await this.secondary.init();
      this.secondary.resize?.(this.game.width, this.game.height);
    }
    this.showingSecondary = !this.showingSecondary;
    this.view.setActive?.(!this.showingSecondary);
    this.secondary.setActive?.(this.showingSecondary);
    this.sim.bus.emit('view:changed', { view: this.showingSecondary ? 'tv' : 'primary' });
  }

  update(dt) {
    const input = this.game.input;
    if (input.pressed('pause')) this.setPaused(!this.paused);
    if (!this.paused) {
      const clock = this.sim.clock;
      if (input.pressed('warpUp')) clock.warpUp();
      if (input.pressed('warpDown')) clock.warpDown();
      if (input.pressed('warpReset')) clock.setWarp(1);
      if (input.pressed('skip')) this.sim.bus.emit('mission:skipRequest');
      if (input.pressed('toggleView')) this.toggleSecondaryView();
      this.sim.step(dt);
      this.runner.frame(dt);
    }
    this.activeView.update(dt, this.paused);
    this.hud.update(dt);
    this.simAudio.update(dt);
  }

  render() {
    this.activeView.render();
  }

  resize(w, h) {
    this.view?.resize?.(w, h);
    this.secondary?.resize?.(w, h);
    this.hud?.resize?.(w, h);
  }

  _onEnd(result) {
    if (this.ending) return;
    this.ending = true;
    setTimeout(() => {
      this.game.goto('debrief', { chapterId: this.chapter.id, missionId: this.mission.id, role: this.role, result });
    }, result.success ? 3500 : 2500);
  }

  exit() {
    this.runner?.cancel('exit');
    this.simAudio?.dispose();
    this.hud?.dispose();
    this.view?.dispose();
    this.secondary?.dispose();
    this.sim?.dispose();
    this.game.audio?.stopAll?.();
  }
}
