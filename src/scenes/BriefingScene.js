// Pre-chapter briefing. STUB by the architect (goes straight to play); the "ui" agent replaces it.
//   enter({ chapterId, role })

export default class BriefingScene {
  constructor(game) {
    this.game = game;
  }

  async enter({ chapterId, role }) {
    queueMicrotask(() => this.game.goto('play', { chapterId, role }));
  }

  update() {}

  render() {}

  exit() {}
}
