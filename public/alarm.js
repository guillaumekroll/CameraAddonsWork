// Son de fin de timer, synthétisé avec Web Audio (aucun fichier audio).
// Utilisé par overlay.html et dashboard.html : window.TimerAlarm.play({ sound, volume, repeat })
(() => {
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Une note : fréquence, départ (s), durée (s), forme d'onde, niveau
  function note(ac, out, freq, at, dur, type = 'sine', level = 1) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  // Chaque motif renvoie sa durée (s)
  const SOUNDS = {
    chime(ac, out, t) {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => note(ac, out, f, t + i * 0.16, 1.1, 'sine', 0.5));
      return 1.6;
    },
    bell(ac, out, t) {
      // partiels inharmoniques d'une cloche
      [[440, 0.6], [1108, 0.3], [1680, 0.15], [2400, 0.08]].forEach(([f, l]) => note(ac, out, f, t, 2.4, 'sine', l));
      [[587, 0.45], [1478, 0.2]].forEach(([f, l]) => note(ac, out, f, t + 0.45, 2, 'sine', l));
      return 2.4;
    },
    beep(ac, out, t) {
      for (let i = 0; i < 4; i++) note(ac, out, 1760, t + i * 0.22, 0.13, 'square', 0.18);
      return 1.1;
    },
    gong(ac, out, t) {
      [[110, 0.7], [165, 0.35], [262, 0.2], [392, 0.1]].forEach(([f, l]) => note(ac, out, f, t, 4, 'sine', l));
      return 3;
    },
  };

  function play({ sound = 'chime', volume = 0.7, repeat = 1 } = {}) {
    const ac = audio();
    if (!ac) return;
    const fn = SOUNDS[sound] || SOUNDS.chime;
    const out = ac.createGain();
    out.gain.value = Math.min(1, Math.max(0, Number(volume) || 0));
    out.connect(ac.destination);
    let t = ac.currentTime + 0.05;
    const n = Math.min(5, Math.max(1, Math.round(Number(repeat) || 1)));
    for (let i = 0; i < n; i++) t += fn(ac, out, t) + 0.25;
  }

  // Les navigateurs bloquent le son tant qu'il n'y a pas eu d'interaction : on débloque au premier geste
  const unlock = () => audio();
  ['pointerdown', 'keydown'].forEach((e) => window.addEventListener(e, unlock, { once: true, capture: true }));

  window.TimerAlarm = { play, sounds: Object.keys(SOUNDS) };
})();
