// Placeholder chapter factory used until a mission agent writes the real chapter.

export function stubChapter(setup, extra = {}) {
  return {
    setup,
    ...extra,
    async run(ctx) {
      ctx.caption(ctx.chapter.title, ctx.chapter.subtitle, 6);
      ctx.say('CAPCOM', 'This chapter is still under construction.', 'Este capítulo todavía está en construcción.', { wait: false });
      const obj = ctx.objective('stub', 'Explora la cabina (capítulo en construcción)');
      await ctx.wait(30);
      obj.done();
      ctx.complete({ summary: 'Capítulo provisional completado.' });
    },
  };
}
