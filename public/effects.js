// Effets de l'overlay : chatons / chiens aléatoires + pluie Matrix.
// Écoute les messages WebSocket relayés par overlay.html (événement 'overlay:msg').
// Emojis animés : Noto Emoji (Google), licence CC BY 4.0.
(() => {
  const W = 1920, H = 1080;
  const params = new URLSearchParams(location.search);
  const only = params.get('only');
  if (only && only !== 'fx') return; // sources "?only=timer|mode|message" : pas d'effets

  const PETS = {
    cat: ['1f431', '1f63a', '1f63b', '1f639', '1f63c', '1f638', '1f63d'],
    dog: ['1f415', '1f429', '1f9ae', '1f415_200d_1f9ba'],
  };
  // Pondération des comportements par espèce
  const MOVES = {
    cat: [['peek', 35], ['side', 25], ['hop', 25], ['roll', 15]],
    dog: [['walk', 50], ['peek', 15], ['hop', 25], ['side', 10]],
  };
  const src = (code) => `/assets/pets/${code}.webp`;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const weighted = (list) => {
    let r = Math.random() * list.reduce((n, [, w]) => n + w, 0);
    for (const [v, w] of list) if ((r -= w) <= 0) return v;
    return list[0][0];
  };

  // ---------- Calques ----------
  const css = document.createElement('style');
  css.textContent = `
    .fx-matrix { position: absolute; inset: 0; width: ${W}px; height: ${H}px; pointer-events: none; opacity: 0; transition: opacity 1.2s ease; }
    .fx-pets { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 50; }
    .fx-pet { position: absolute; left: 0; top: 0; will-change: transform; }
    .fx-pet img { display: block; width: 100%; height: 100%; filter: drop-shadow(0 10px 14px rgba(0,0,0,.45)); }
    .fx-pet.bob img { animation: fxBob .42s ease-in-out infinite alternate; }
    .fx-pet.wiggle img { animation: fxWiggle 1.1s ease-in-out infinite; }
    .fx-paw { position: absolute; width: 34px; height: 34px; pointer-events: none;
      filter: grayscale(1) brightness(1.7); opacity: .75; animation: fxPaw 2.6s ease-out forwards; }
    @keyframes fxBob { from { transform: translateY(0) rotate(-3deg); } to { transform: translateY(-14%) rotate(3deg); } }
    @keyframes fxWiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-9deg); } 75% { transform: rotate(9deg); } }
    @keyframes fxPaw { from { opacity: .75; } to { opacity: 0; } }
  `;
  document.head.appendChild(css);

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-matrix';
  canvas.width = W;
  canvas.height = H;
  const stage = document.getElementById('stage');
  // Matrix derrière le panneau, animaux devant
  stage ? stage.before(canvas) : document.body.prepend(canvas);
  const petLayer = document.createElement('div');
  petLayer.className = 'fx-pets';
  document.body.appendChild(petLayer);

  // ---------- Config ----------
  let cfg = {
    cats: false, dogs: false, petMinSec: 30, petMaxSec: 90, petSize: 180,
    matrix: false, matrixOpacity: 0.35, matrixColor: '#00ff66', matrixSpeed: 1,
  };
  const timers = { cat: 0, dog: 0 };
  let preloaded = false;

  function preload() {
    if (preloaded) return;
    preloaded = true;
    for (const code of [...PETS.cat, ...PETS.dog, '1f43e']) new Image().src = src(code);
  }

  function schedule(kind, enabled) {
    if (!enabled) {
      clearTimeout(timers[kind]);
      timers[kind] = 0;
      return;
    }
    if (timers[kind]) return; // déjà planifié
    const delay = rand(cfg.petMinSec, cfg.petMaxSec) * 1000;
    timers[kind] = setTimeout(() => {
      timers[kind] = 0;
      spawnPet(kind);
      schedule(kind, kind === 'cat' ? cfg.cats : cfg.dogs);
    }, delay);
  }

  function applyState(state) {
    const fx = (state && state.fx) || {};
    const prev = cfg;
    cfg = { ...cfg, ...fx };
    // Intervalle modifié : on replanifie avec les nouvelles bornes
    if (prev.petMinSec !== cfg.petMinSec || prev.petMaxSec !== cfg.petMaxSec) {
      schedule('cat', false);
      schedule('dog', false);
    }
    if (cfg.cats || cfg.dogs) preload();
    schedule('cat', !!cfg.cats);
    schedule('dog', !!cfg.dogs);
    matrix.update();
  }

  // ---------- Animaux ----------
  // Zones à éviter (panneau + message) pour les apparitions statiques
  function busyRects() {
    return ['panel', 'msg']
      .map((id) => document.getElementById(id))
      .filter((el) => el && el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
  }
  function freeX(size) {
    const rects = busyRects().filter((r) => r.bottom > H - size * 1.2);
    for (let i = 0; i < 12; i++) {
      const x = rand(40, W - size - 40);
      if (!rects.some((r) => x + size > r.left - 20 && x < r.right + 20)) return x;
    }
    return rand(40, W - size - 40);
  }
  function freeY(size, side) {
    const rects = busyRects().filter((r) => (side === 'left' ? r.left < size * 1.2 : r.right > W - size * 1.2));
    for (let i = 0; i < 12; i++) {
      const y = rand(80, H - size - 80);
      if (!rects.some((r) => y + size > r.top - 20 && y < r.bottom + 20)) return y;
    }
    return rand(80, H - size - 80);
  }

  function makePet(kind, size) {
    const el = document.createElement('div');
    el.className = 'fx-pet';
    el.style.width = el.style.height = size + 'px';
    const img = document.createElement('img');
    img.src = src(pick(PETS[kind]));
    img.alt = '';
    el.appendChild(img);
    petLayer.appendChild(el);
    return el;
  }

  function spawnPet(kind, forcedMove) {
    const size = cfg.petSize * rand(0.85, 1.15);
    const move = forcedMove || weighted(MOVES[kind]);
    const el = makePet(kind, size);
    const done = () => el.remove();
    let anim;

    if (move === 'peek') {
      // surgit du bas de l'écran, regarde, et redescend
      const x = freeX(size);
      el.classList.add('wiggle');
      const t = (y, r = 0) => `translate(${x}px, ${y}px) rotate(${r}deg)`;
      anim = el.animate(
        [
          { transform: t(H + 10) },
          { transform: t(H - size * 0.82, -4), offset: 0.14 },
          { transform: t(H - size * 0.78, 4), offset: 0.5 },
          { transform: t(H - size * 0.85, 0), offset: 0.8 },
          { transform: t(H + 10) },
        ],
        { duration: rand(4200, 6000), easing: 'cubic-bezier(.3,1.4,.5,1)' },
      );
    } else if (move === 'side') {
      // se penche depuis un bord latéral
      const side = Math.random() < 0.5 ? 'left' : 'right';
      const y = freeY(size, side);
      const rot = side === 'left' ? 90 : -90;
      const out = side === 'left' ? -size - 10 : W + 10;
      const inn = side === 'left' ? -size * 0.25 : W - size * 0.75;
      const t = (x, r) => `translate(${x}px, ${y}px) rotate(${r}deg)`;
      anim = el.animate(
        [
          { transform: t(out, rot) },
          { transform: t(inn, rot), offset: 0.18 },
          { transform: t(inn, rot - Math.sign(rot) * 12), offset: 0.45 },
          { transform: t(inn, rot), offset: 0.75 },
          { transform: t(out, rot) },
        ],
        { duration: rand(4000, 5500), easing: 'ease-in-out' },
      );
    } else if (move === 'hop') {
      // saut en arc d'un point bas à un autre
      const ltr = Math.random() < 0.5;
      const x0 = ltr ? -size : W;
      const x1 = ltr ? rand(W * 0.55, W) : rand(-size, W * 0.45 - size);
      const peak = rand(H * 0.25, H * 0.55);
      const flip = kind === 'dog' && ltr ? -1 : 1; // les chiens regardent à gauche
      const frames = [];
      for (let i = 0; i <= 20; i++) {
        const p = i / 20;
        const x = x0 + (x1 - x0) * p;
        const y = H - size * 0.9 - Math.sin(Math.PI * p) * (H - size - peak) + (p > 0.85 ? (p - 0.85) * 8 * size : 0);
        const r = (ltr ? 1 : -1) * (p * 360 * (kind === 'cat' ? 1 : 0));
        frames.push({ transform: `translate(${x}px, ${y}px) scaleX(${flip}) rotate(${r}deg)` });
      }
      anim = el.animate(frames, { duration: rand(2600, 3400), easing: 'linear' });
    } else if (move === 'roll') {
      // tête qui roule le long du bas de l'écran
      const ltr = Math.random() < 0.5;
      const y = H - size * 0.95;
      const turns = (W + size) / (Math.PI * size);
      anim = el.animate(
        [
          { transform: `translate(${ltr ? -size : W}px, ${y}px) rotate(0deg)` },
          { transform: `translate(${ltr ? W : -size}px, ${y}px) rotate(${(ltr ? 1 : -1) * turns * 360}deg)` },
        ],
        { duration: rand(6000, 8000), easing: 'linear' },
      );
    } else {
      // walk : traverse l'écran en bas en laissant des empreintes
      const ltr = Math.random() < 0.5;
      const y = H - size * 0.98;
      el.classList.add('bob');
      const flip = ltr ? -1 : 1;
      const duration = rand(8000, 11000);
      anim = el.animate(
        [
          { transform: `translate(${ltr ? -size : W}px, ${y}px) scaleX(${flip})` },
          { transform: `translate(${ltr ? W : -size}px, ${y}px) scaleX(${flip})` },
        ],
        { duration, easing: 'linear' },
      );
      const start = performance.now();
      let n = 0;
      const paws = setInterval(() => {
        const p = (performance.now() - start) / duration;
        if (p >= 1) return clearInterval(paws);
        const x = (ltr ? -size + (W + size) * p : W - (W + size) * p) + size / 2;
        const paw = document.createElement('img');
        paw.className = 'fx-paw';
        paw.src = src('1f43e');
        paw.style.left = x + 'px';
        paw.style.top = H - 40 - (n++ % 2) * 16 + 'px';
        paw.style.transform = `rotate(${ltr ? 90 : -90}deg)`;
        petLayer.appendChild(paw);
        setTimeout(() => paw.remove(), 2700);
      }, 380);
      anim.finished.finally(() => clearInterval(paws));
    }
    anim.finished.then(done, done);
  }

  // ---------- Matrix ----------
  const matrix = (() => {
    const ctx = canvas.getContext('2d');
    const FONT = 22;
    const COLS = Math.ceil(W / FONT);
    const CHARS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEFZ:.=*+-<>¦|';
    let drops = [];
    let raf = 0;
    let last = 0;
    let burstUntil = 0;
    let fadeTimer = 0;

    const reset = () => {
      drops = Array.from({ length: COLS }, () => rand(-20, H / FONT / 3)); // remplit vite l'écran
      ctx.clearRect(0, 0, W, H);
    };

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const speed = cfg.matrixSpeed || 1;
      if (now - last < 50 / speed) return;
      last = now;
      // Efface progressivement vers la transparence (l'overlay reste transparent)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.055)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = `600 ${FONT}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.shadowColor = cfg.matrixColor;
      for (let i = 0; i < COLS; i++) {
        const y = drops[i] * FONT;
        if (y > 0) {
          const ch = CHARS[(Math.random() * CHARS.length) | 0];
          // tête claire, traîne colorée
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#e8fff0';
          ctx.fillText(ch, i * FONT, y);
          // l'ancienne tête (case du dessus) repasse en couleur : on vide la case avant
          ctx.shadowBlur = 0;
          ctx.clearRect(i * FONT, y - FONT * 1.85, FONT, FONT);
          ctx.fillStyle = cfg.matrixColor;
          ctx.fillText(CHARS[(Math.random() * CHARS.length) | 0], i * FONT, y - FONT);
        }
        if (y > H && Math.random() > 0.975) drops[i] = rand(-8, 0);
        drops[i] += 1;
      }
    }

    function start() {
      if (raf) return;
      reset();
      last = 0;
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      ctx.clearRect(0, 0, W, H);
    }

    function update() {
      clearTimeout(fadeTimer);
      const bursting = performance.now() < burstUntil;
      if (cfg.matrix || bursting) {
        start();
        canvas.style.opacity = bursting ? Math.max(0.85, cfg.matrixOpacity) : cfg.matrixOpacity;
      } else {
        canvas.style.opacity = 0;
        fadeTimer = setTimeout(stop, 1300); // après la transition d'opacité
      }
    }

    function burst(ms = 9000) {
      burstUntil = performance.now() + ms;
      update();
      setTimeout(update, ms + 20);
    }

    return { update, burst };
  })();

  // ---------- Messages ----------
  window.addEventListener('overlay:msg', (e) => {
    const d = e.detail;
    if (d.type === 'state') applyState(d.state);
    else if (d.type === 'fx') {
      if (d.effect === 'cat' || d.effect === 'dog') {
        preload();
        spawnPet(d.effect);
      } else if (d.effect === 'matrix') matrix.burst();
    }
  });
  if (window.__overlayLastState) applyState(window.__overlayLastState.state);

  // Test rapide sans serveur : overlay?preview=1&fx=cat|dog|matrix
  const test = params.get('fx');
  if (test === 'matrix') matrix.burst(60000);
  else if (test === 'cat' || test === 'dog') {
    const moves = MOVES[test].map(([m]) => m);
    moves.forEach((m, i) => setTimeout(() => spawnPet(test, m), i * 400));
  }
})();
