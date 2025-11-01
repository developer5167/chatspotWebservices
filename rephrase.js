function rephrase(text) {
  const replacements = [
    { find: /\bi'm\b/gi, repl: ["I am", "doing", "feeling"] },
    { find: /\byou\?\b/gi, repl: ["you doing?", "your side?", "you there?"] },
    { find: /\byeah\b/gi, repl: ["ya", "yep", "yes"] },
    { find: /\bhmm\b/gi, repl: ["hmm", "ya", "ok"] },
  ];
  let out = text;
  for (const r of replacements) {
    if (r.find.test(out) && Math.random() < 0.4) {
      out = out.replace(r.find, r.repl[Math.floor(Math.random() * r.repl.length)]);
    }
  }
  return out;
}
module.exports = { rephrase };

