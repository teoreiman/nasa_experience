// Per-chapter audio director: maps simulation state/events to sound (engine roar by thrust and
// view, staging bangs, RCS thumps, cabin fans/pumps, C&W master alarm tone, switch clicks,
// entry plasma roar, MOCR room ambience and voice loops in controller mode).
// STUB by the architect; the "audio" agent implements it.

export class SimAudio {
  constructor({ game, sim, view, role }) {
    this.game = game;
    this.sim = sim;
    this.view = view;
    this.role = role;
  }

  update(dt) {}

  dispose() {}
}
