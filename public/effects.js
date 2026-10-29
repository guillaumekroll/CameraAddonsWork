// Effets de l'overlay : chatons / chiens aléatoires, pluie Matrix, feu d'artifice, anniversaire, dodo.
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
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
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
  // Matrix au-dessus du voile / de la teinte, sous le contour et le panneau ; animaux devant
  const edge = document.getElementById('edge');
  edge ? edge.before(canvas) : document.body.prepend(canvas);
  const petLayer = document.createElement('div');
  petLayer.className = 'fx-pets';
  document.body.appendChild(petLayer);

  // ---------- Config ----------
  let cfg = {
    cats: false, dogs: false, petMinSec: 30, petMaxSec: 90, petSize: 180,
    sleepAfk: false, sleepWakeAfk: true, sleepUnlimited: false, sleepSec: 30, sleepSize: 320, sleepLeft: 0,
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

  // ---------- Feu d'artifice ----------
  const fireworks = (() => {
    const cv = document.createElement('canvas');
    cv.className = 'fx-fireworks';
    cv.width = W;
    cv.height = H;
    petLayer.before(cv); // devant le panneau, sous les animaux
    const ctx = cv.getContext('2d');
    const COLORS = ['#ff4d6d', '#ffd23f', '#3ef0a4', '#38e1ff', '#b38cff', '#ff8fd8', '#ffffff', '#ff9f1c'];
    const rockets = [];
    const sparks = [];
    let raf = 0;
    let showUntil = 0;
    let nextLaunch = 0;

    function launch(x = rand(W * 0.1, W * 0.9), ty = rand(H * 0.12, H * 0.5)) {
      // vitesse initiale calculée pour atteindre ty avec la gravité
      const g = 0.12;
      const vy = -Math.sqrt(2 * g * (H - ty));
      rockets.push({ x, y: H, vx: rand(-1.2, 1.2), vy, g, color: pick(COLORS) });
      start();
    }

    function explode(x, y, color, count = Math.round(rand(70, 120)), power = 1) {
      const color2 = Math.random() < 0.4 ? pick(COLORS) : color;
      for (let i = 0; i < count; i++) {
        const a = (Math.PI * 2 * i) / count + rand(-0.05, 0.05);
        const sp = rand(2, 7.5) * power;
        sparks.push({
          x, y, px: x, py: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, decay: rand(0.008, 0.016),
          color: i % 3 ? color : color2,
          glitter: Math.random() < 0.25,
        });
      }
      start();
    }

    function frame(now) {
      // traînées : effacement progressif vers la transparence
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      if (now < showUntil && now >= nextLaunch) {
        launch();
        if (Math.random() < 0.35) launch();
        nextLaunch = now + rand(260, 620);
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        const px = r.x, py = r.y;
        r.x += r.vx;
        r.y += r.vy;
        r.vy += r.g;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
        if (r.vy >= -0.5) {
          rockets.splice(i, 1);
          explode(r.x, r.y, r.color);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i];
        p.px = p.x;
        p.py = p.y;
        p.vx *= 0.975;
        p.vy = p.vy * 0.975 + 0.06;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        if (p.glitter && Math.random() < 0.5) continue; // scintillement
        ctx.globalAlpha = Math.min(1, p.life * 1.4);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(p.px, p.py);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      if (rockets.length || sparks.length || now < showUntil) raf = requestAnimationFrame(frame);
      else {
        raf = 0;
        ctx.clearRect(0, 0, W, H);
      }
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(frame);
    }

    // Spectacle de ms millisecondes
    function show(ms = 8000) {
      showUntil = Math.max(showUntil, performance.now() + ms);
      nextLaunch = 0;
      for (let i = 0; i < 4; i++) setTimeout(() => launch(), i * 150);
      start();
    }

    return { show, explode, launch };
  })();

  // ---------- Anniversaire ----------
  const PARTY = ['1f382', '1f9c1', '1f370', '1f381', '1f389', '1f38a', '1f973', '2728', '1f388'];
  const CAKES = ['1f382', '1f9c1', '1f370'];
  const partySrc = (code) => `/assets/party/${code}.${code === '1f9c1' || code === '1f370' ? 'svg' : 'webp'}`;
  const partyCss = document.createElement('style');
  partyCss.textContent = `
    .fx-fireworks { position: absolute; inset: 0; width: ${W}px; height: ${H}px; pointer-events: none; z-index: 45; }
    .fx-pop { position: absolute; left: 0; top: 0; z-index: 1; will-change: transform, opacity; }
    .fx-pop img { display: block; width: 100%; height: 100%; filter: drop-shadow(0 10px 18px rgba(0,0,0,.45)); }
    .bd { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column;
      align-items: center; text-align: center; pointer-events: none; z-index: 3; }
    .bd-cake { width: 300px; height: 300px; animation: bdCakeIn 1s cubic-bezier(.2,1.6,.4,1) both, bdFloat 2.4s ease-in-out 1s infinite; }
    .bd-cake img { width: 100%; height: 100%; filter: drop-shadow(0 0 40px rgba(255,210,63,.55)) drop-shadow(0 16px 24px rgba(0,0,0,.5)); }
    .bd-title { margin-top: 6px; font-family: var(--font-display, sans-serif); font-weight: 900; font-size: 74px; letter-spacing: .06em;
      line-height: 1; white-space: nowrap; }
    .bd-title span { display: inline-block; background: linear-gradient(180deg,#ff4d6d,#ffd23f,#3ef0a4,#38e1ff,#b38cff,#ff4d6d) 0 0 / 100% 600%;
      -webkit-background-clip: text; background-clip: text; color: transparent;
      filter: drop-shadow(0 0 14px rgba(255,255,255,.35)) drop-shadow(0 6px 10px rgba(0,0,0,.6));
      animation: bdLetter .7s cubic-bezier(.2,1.8,.4,1) both, bdRainbow 3s linear infinite; }
    .bd-name { margin-top: 14px; font-family: var(--font-display, sans-serif); font-weight: 900; font-size: 110px; line-height: 1;
      color: #fff; text-transform: uppercase; white-space: nowrap;
      text-shadow: 0 0 30px rgba(255,210,63,.9), 0 0 60px rgba(255,77,109,.6), 0 8px 18px rgba(0,0,0,.6);
      animation: bdName 1s cubic-bezier(.2,1.6,.4,1) .9s both, bdPulse 1.2s ease-in-out 2s infinite; }
    .bd.out { animation: bdOut .7s ease-in forwards; }
    @keyframes bdCakeIn { from { transform: scale(0) rotate(-25deg); } to { transform: none; } }
    @keyframes bdFloat { 50% { transform: translateY(-14px) rotate(2deg); } }
    @keyframes bdLetter { from { transform: translateY(-120px) scale(.3); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes bdRainbow { to { background-position: 0 600%; } }
    @keyframes bdName { from { transform: scale(0); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes bdPulse { 50% { transform: scale(1.06); } }
    @keyframes bdOut { to { transform: translate(-50%, -50%) scale(1.4); opacity: 0; filter: blur(8px); } }
  `;
  document.head.appendChild(partyCss);

  // Un objet qui "pop" : surgit d'un bord (ou apparaît au centre), tourne, puis éclate en étincelles
  function popItem(from) {
    const size = rand(110, 190);
    const el = document.createElement('div');
    el.className = 'fx-pop';
    el.style.width = el.style.height = size + 'px';
    const img = document.createElement('img');
    const code = Math.random() < 0.55 ? pick(CAKES) : pick(PARTY);
    img.src = partySrc(code);
    img.alt = '';
    el.appendChild(img);
    petLayer.appendChild(el);

    let sx, sy, ex, ey;
    const inset = rand(140, 420);
    if (from === 'left') [sx, sy, ex, ey] = [-size, rand(80, H - 200), inset, rand(100, H - 260)];
    else if (from === 'right') [sx, sy, ex, ey] = [W, rand(80, H - 200), W - inset - size, rand(100, H - 260)];
    else if (from === 'top') [sx, sy, ex, ey] = [rand(100, W - 300), -size, rand(120, W - 320), inset * 0.7];
    else if (from === 'bottom') [sx, sy, ex, ey] = [rand(100, W - 300), H, rand(120, W - 320), H - inset - size];
    else {
      // centre : apparition sur place autour du milieu
      ex = W / 2 + rand(-560, 560) - size / 2;
      ey = H / 2 + rand(-380, 380) - size / 2;
      sx = ex;
      sy = ey;
    }
    const spin = rand(-200, 200);
    const t = (x, y, s, r) => `translate(${x}px, ${y}px) scale(${s}) rotate(${r}deg)`;
    const hold = rand(900, 1600);
    const anim = el.animate(
      [
        { transform: t(sx, sy, from === 'center' ? 0 : 0.6, 0), opacity: 1 },
        { transform: t(ex, ey, 1.15, spin * 0.6), opacity: 1, offset: 0.3 },
        { transform: t(ex, ey, 1, spin * 0.8), opacity: 1, offset: 0.4 },
        { transform: t(ex, ey + 10, 1, spin), opacity: 1, offset: 0.85 },
        { transform: t(ex, ey, 1.5, spin), opacity: 0 },
      ],
      { duration: 900 + hold, easing: 'cubic-bezier(.25,1.2,.4,1)' },
    );
    // éclate en étincelles à la disparition
    setTimeout(() => fireworks.explode(ex + size / 2, ey + size / 2, pick(['#ffd23f', '#ff4d6d', '#ff8fd8', '#3ef0a4']), 40, 0.7), (900 + hold) * 0.86);
    anim.finished.then(() => el.remove(), () => el.remove());
  }

  // Ballons qui montent du bas sur toute la hauteur
  function balloon() {
    const size = rand(110, 170);
    const el = document.createElement('div');
    el.className = 'fx-pop';
    el.style.width = el.style.height = size + 'px';
    el.innerHTML = `<img src="${partySrc('1f388')}" alt="">`;
    petLayer.appendChild(el);
    const x = rand(0, W - size);
    const drift = rand(-160, 160);
    el.animate(
      [
        { transform: `translate(${x}px, ${H}px) rotate(-6deg)` },
        { transform: `translate(${x + drift * 0.5}px, ${H / 2}px) rotate(6deg)`, offset: 0.5 },
        { transform: `translate(${x + drift}px, ${-size * 1.2}px) rotate(-4deg)` },
      ],
      { duration: rand(5500, 8000), easing: 'ease-in' },
    ).finished.then(() => el.remove(), () => el.remove());
  }

  let birthdayEl = null;
  let birthdayTimers = [];
  function birthday(name = '', ms = 13000) {
    birthdayTimers.forEach(clearTimeout);
    birthdayTimers = [];
    if (birthdayEl) birthdayEl.remove();
    for (const code of PARTY) new Image().src = partySrc(code);

    // Bannière centrale
    const bd = document.createElement('div');
    bd.className = 'bd';
    const title = 'JOYEUX ANNIVERSAIRE';
    bd.innerHTML = `<div class="bd-cake"><img src="${partySrc('1f382')}" alt=""></div><div class="bd-title"></div>`;
    const titleEl = bd.querySelector('.bd-title');
    [...title].forEach((ch, i) => {
      const s = document.createElement('span');
      s.textContent = ch === ' ' ? ' ' : ch;
      s.style.animationDelay = `${0.3 + i * 0.04}s, -${i * 0.16}s`; // arc-en-ciel décalé par lettre
      titleEl.appendChild(s);
    });
    if (name) {
      const n = document.createElement('div');
      n.className = 'bd-name';
      n.textContent = name + ' !';
      bd.appendChild(n);
    }
    petLayer.appendChild(bd);
    birthdayEl = bd;

    // Le nom ne doit pas dépasser l'écran
    requestAnimationFrame(() => {
      const r = bd.getBoundingClientRect();
      if (r.width > W - 80) bd.style.transform = `translate(-50%, -50%) scale(${(W - 80) / r.width})`;
    });

    fireworks.show(ms - 1500);
    // Gâteaux et cadeaux de tous les côtés + au centre
    const sides = ['left', 'right', 'top', 'bottom', 'center', 'center'];
    const end = ms - 2200;
    for (let tms = 200; tms < end; tms += rand(160, 320)) {
      birthdayTimers.push(setTimeout(() => popItem(pick(sides)), tms));
    }
    for (let tms = 0; tms < end; tms += rand(500, 900)) birthdayTimers.push(setTimeout(balloon, tms));
    // grosse explosion au centre à l'arrivée du gâteau
    birthdayTimers.push(setTimeout(() => fireworks.explode(W / 2, H / 2 - 120, '#ffd23f', 160, 1.4), 650));

    birthdayTimers.push(
      setTimeout(() => {
        bd.classList.add('out');
        fireworks.explode(W / 2, H / 2, '#ff4d6d', 180, 1.6);
        setTimeout(() => bd.remove(), 800);
      }, ms - 800),
    );
  }

  // ---------- Dodo : personnage (photo de l'utilisateur) qui va se coucher ----------
  const sleeper = (() => {
    const DEFAULT_FACE = '/assets/sleep/face.svg';
    const PYJAMA = '#5b7cfa', PYJAMA_2 = '#c9d4ff';
    let face = DEFAULT_FACE;
    let run = null; // dodo en cours : { auto, cancelled, els, timers, anims }

    const BED = `<svg viewBox="0 0 100 55" width="100%" height="100%">
      <rect x="2" y="8" width="9" height="45" rx="3" fill="#8d5a34"/>
      <rect x="0" y="5" width="13" height="6" rx="3" fill="#a96c3f"/>
      <rect x="90" y="24" width="8" height="29" rx="3" fill="#8d5a34"/>
      <rect x="88" y="21" width="12" height="5" rx="2.5" fill="#a96c3f"/>
      <rect x="11" y="47" width="5" height="8" fill="#5a361e"/><rect x="84" y="47" width="5" height="8" fill="#5a361e"/>
      <rect x="8" y="40" width="84" height="8" rx="2" fill="#6e4426"/>
      <rect x="9" y="31" width="83" height="11" rx="4" fill="#eef1f8"/>
      <ellipse cx="22" cy="29" rx="12" ry="6" fill="#fff" stroke="#d8deea" stroke-width=".8"/>
    </svg>`;
    const BLANKET = `<svg viewBox="0 0 100 55" width="100%" height="100%">
      <path d="M30 27 Q45 15 62 21 Q78 26 93 24 L93 43 L30 43 Z" fill="${PYJAMA}"/>
      <path d="M30 29 Q45 18 62 23.5 Q78 28.5 93 26.5" stroke="${PYJAMA_2}" stroke-width="2.4" fill="none"/>
      <g fill="#fff" opacity=".55"><circle cx="44" cy="31" r="1.3"/><circle cx="58" cy="36" r="1.3"/><circle cx="72" cy="32" r="1.3"/><circle cx="84" cy="37" r="1.3"/><circle cx="50" cy="39" r="1"/><circle cx="66" cy="40" r="1"/></g>
    </svg>`;
    const BODY = `<svg viewBox="0 0 30 42" width="100%" height="100%">
      <g class="limb armL"><rect x="1.5" y="3" width="5" height="16" rx="2.5" fill="${PYJAMA}"/><circle cx="4" cy="19" r="2.4" fill="#ffcc80"/></g>
      <g class="limb armR"><rect x="23.5" y="3" width="5" height="16" rx="2.5" fill="${PYJAMA}"/><circle cx="26" cy="19" r="2.4" fill="#ffcc80"/></g>
      <g class="limb legL"><rect x="7.5" y="19" width="6.5" height="20" rx="3" fill="${PYJAMA}"/><ellipse cx="10" cy="40" rx="4.6" ry="2.2" fill="#3a3f55"/></g>
      <g class="limb legR"><rect x="16" y="19" width="6.5" height="20" rx="3" fill="${PYJAMA}"/><ellipse cx="20" cy="40" rx="4.6" ry="2.2" fill="#3a3f55"/></g>
      <rect x="5" y="0" width="20" height="23" rx="6" fill="${PYJAMA}"/>
      <g fill="${PYJAMA_2}" opacity=".7"><rect x="9" y="2" width="2" height="19"/><rect x="14" y="2" width="2" height="19"/><rect x="19" y="2" width="2" height="19"/></g>
    </svg>`;
    const CAP = `<svg viewBox="0 0 70 44" width="100%" height="100%">
      <path d="M6 34 Q22 0 62 8 Q46 18 58 34 Z" fill="${PYJAMA}"/>
      <rect x="2" y="30" width="58" height="11" rx="5.5" fill="#fff"/>
      <circle cx="62" cy="8" r="6" fill="#fff"/>
    </svg>`;

    const css = document.createElement('style');
    css.textContent = `
      .fx-sl { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform, opacity; }
      .fx-sl svg { display: block; overflow: visible; }
      .fx-face { position: absolute; border-radius: 50%; overflow: hidden; background: #ffcc80;
        box-shadow: 0 0 0 3px #fff, 0 6px 14px rgba(0,0,0,.4); }
      .fx-face img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .fx-walker .limb { transform-box: fill-box; transform-origin: 50% 8%; }
      .fx-walker.walking .legL, .fx-walker.walking .armR { animation: fxLimb .42s ease-in-out infinite alternate; }
      .fx-walker.walking .legR, .fx-walker.walking .armL { animation: fxLimb .42s ease-in-out infinite alternate-reverse; }
      .fx-walker.walking .fx-wbody { animation: fxStep .21s ease-in-out infinite alternate; }
      .fx-walker .fx-face { animation: fxYawn 2.4s ease-in-out infinite; }
      .fx-blanket { transform-origin: 50% 78%; animation: fxBreathe 2.2s ease-in-out infinite alternate; }
      .fx-dozer { transform-origin: 50% 100%; animation: fxDoze 2.2s ease-in-out infinite alternate; }
      .fx-z { position: absolute; left: 0; top: 0; font: 900 40px/1 system-ui, sans-serif; color: #fff;
        -webkit-text-stroke: 2px #1b2140; paint-order: stroke fill; text-shadow: 0 4px 10px rgba(0,0,0,.45); will-change: transform, opacity; }
      @keyframes fxLimb { from { transform: rotate(24deg); } to { transform: rotate(-24deg); } }
      @keyframes fxStep { from { transform: translateY(0); } to { transform: translateY(-4%); } }
      @keyframes fxYawn { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
      @keyframes fxBreathe { from { transform: scaleY(1); } to { transform: scaleY(1.07); } }
      @keyframes fxDoze { from { transform: rotate(-14deg) translateY(0); } to { transform: rotate(-10deg) translateY(2%); } }
    `;
    document.head.appendChild(css);

    function setFace(url) {
      face = url || DEFAULT_FACE;
      new Image().src = face;
    }
    function el(cls, w, h, html = '') {
      const e = document.createElement('div');
      e.className = 'fx-sl ' + cls;
      e.style.width = w + 'px';
      e.style.height = h + 'px';
      e.innerHTML = html;
      petLayer.appendChild(e);
      run.els.push(e);
      return e;
    }
    function faceEl(parent, d, left, top) {
      const f = document.createElement('div');
      f.className = 'fx-face';
      Object.assign(f.style, { width: d + 'px', height: d + 'px', left: left + 'px', top: top + 'px' });
      const img = document.createElement('img');
      img.src = face;
      img.alt = '';
      img.onerror = () => { if (img.src.indexOf(DEFAULT_FACE) < 0) img.src = DEFAULT_FACE; };
      f.appendChild(img);
      parent.appendChild(f);
      return f;
    }
    const anim = (e, frames, opts) => {
      const a = e.animate(frames, { fill: 'forwards', ...opts });
      run.anims.push(a);
      return a.finished.catch(() => {});
    };
    const wait = (ms) => new Promise((r) => run.timers.push(setTimeout(r, ms)));

    // ms = 0 : pas de limite de temps. auto = dodo lié au mode AFK (sans limite tant qu'on y reste)
    function scheduleEnd(me) {
      clearTimeout(me.endTimer);
      if (me.asleep && !me.auto && me.ms) me.endTimer = setTimeout(() => stop(me), me.ms);
    }
    function setAuto(on, ms = 0) {
      if (!run) return;
      run.auto = on;
      run.ms = ms;
      scheduleEnd(run);
    }

    async function start(ms, auto) {
      if (run) {
        if (!auto && run.auto) return; // déjà endormi par le mode AFK
        if (!auto) { run.ms = ms; scheduleEnd(run); return; } // relance : repart pour une durée complète
        stop(run, true);
      }
      const me = (run = { auto, ms, cancelled: false, els: [], timers: [], anims: [] });
      const u = cfg.sleepSize || 320;          // largeur du lit
      const bedH = u * 0.55;
      const bx = clamp(Number(cfg.sleepLeft) || 0, 0, 200), by = H - bedH - 10; // calé à gauche + décalage
      const d = u * 0.26;                       // diamètre de la tête qui marche
      const ww = u * 0.3, bh = u * 0.42, wh = d * 0.85 + bh;
      const floorY = H - 10 - wh;

      // 1. le lit monte depuis le bas
      const bed = el('fx-bed', u, bedH, BED);
      bed.style.transform = `translate(${bx}px, ${by}px)`;
      await anim(bed, [
        { transform: `translate(${bx}px, ${by + bedH}px)`, opacity: 0 },
        { transform: `translate(${bx}px, ${by}px)`, opacity: 1 },
      ], { duration: 700, easing: 'cubic-bezier(.2,1.3,.4,1)' });
      if (me.cancelled) return;

      // 2. le personnage arrive à pied depuis le bord le plus proche
      const ltr = bx + u / 2 < W / 2 && bx > ww * 1.1; // pas la place à gauche du lit : arrive par la droite
      const walker = el('fx-walker walking', ww, wh);
      const wbody = document.createElement('div');
      wbody.className = 'fx-wbody';
      Object.assign(wbody.style, { position: 'absolute', inset: '0' });
      wbody.innerHTML = `<div style="position:absolute;left:0;top:${d * 0.85}px;width:${ww}px;height:${bh}px">${BODY}</div>`;
      faceEl(wbody, d, (ww - d) / 2, 0);
      walker.appendChild(wbody);
      const x0 = ltr ? -ww - 20 : W + 20;
      const x1 = ltr ? bx - ww * 1.05 : bx + u + ww * 0.05; // s'arrête à côté du lit
      const speed = 320 * (u / 320);
      await anim(walker, [
        { transform: `translate(${x0}px, ${floorY}px)` },
        { transform: `translate(${x1}px, ${floorY}px)` },
      ], { duration: clamp(Math.abs(x1 - x0) / speed * 1000, 1200, 5000), easing: 'linear' });
      if (me.cancelled) return;
      walker.classList.remove('walking');
      await wait(450);
      if (me.cancelled) return;

      // 3. saut dans le lit
      const x2 = bx + u * 0.55 - ww / 2, top2 = by - wh * 0.15;
      const hop = [];
      for (let i = 0; i <= 12; i++) {
        const p = i / 12;
        const x = x1 + (x2 - x1) * p;
        const y = floorY + (top2 - floorY) * p - Math.sin(Math.PI * p) * u * 0.35;
        const r = (ltr ? -1 : 1) * 70 * p;
        hop.push({ transform: `translate(${x}px, ${y}px) rotate(${r}deg) scale(${1 - 0.25 * p})`, opacity: p > 0.8 ? (1 - p) * 5 : 1 });
      }
      await anim(walker, hop, { duration: 750, easing: 'ease-in' });
      if (me.cancelled) return;
      walker.remove();

      // 4. couché : tête sur l'oreiller avec bonnet de nuit, couverture qui respire
      const hd = u * 0.24;
      const head = el('', hd, hd);
      const doze = document.createElement('div');
      doze.className = 'fx-dozer';
      Object.assign(doze.style, { position: 'absolute', inset: '0' });
      faceEl(doze, hd, 0, 0);
      const cap = document.createElement('div');
      Object.assign(cap.style, { position: 'absolute', left: -hd * 0.12 + 'px', top: -hd * 0.5 + 'px', width: hd * 1.2 + 'px', height: hd * 0.75 + 'px' });
      cap.innerHTML = CAP;
      doze.appendChild(cap);
      head.appendChild(doze);
      head.style.transform = `translate(${bx + u * 0.22 - hd / 2}px, ${by + bedH * 0.5 - hd}px)`;
      const blanket = el('', u, bedH, `<div class="fx-blanket" style="width:100%;height:100%">${BLANKET}</div>`);
      blanket.style.transform = `translate(${bx}px, ${by}px)`;
      anim(blanket, [
        { transform: `translate(${bx}px, ${by - u * 0.1}px) scaleY(1.25)`, opacity: 0 },
        { transform: `translate(${bx}px, ${by}px)`, opacity: 1 },
      ], { duration: 380, easing: 'cubic-bezier(.3,1.5,.5,1)' });
      const hx = bx + u * 0.22 - hd / 2, hy = by + bedH * 0.5 - hd;
      await anim(head, [
        { transform: `translate(${hx}px, ${hy}px) scale(0)` },
        { transform: `translate(${hx}px, ${hy}px) scale(1.12)`, offset: 0.7 },
        { transform: `translate(${hx}px, ${hy}px) scale(1)` },
      ], { duration: 450, easing: 'ease-out' });
      if (me.cancelled) return;

      // 5. zZzZz qui s'envolent au-dessus de la tête
      let n = 0;
      const zx = hx + hd * 0.8, zy = hy - hd * 0.1;
      const puff = () => {
        if (me.cancelled || me.waking) return;
        const z = document.createElement('div');
        z.className = 'fx-z';
        z.textContent = n++ % 2 ? 'Z' : 'z';
        z.style.fontSize = u * (n % 2 ? 0.1 : 0.075) + 'px';
        petLayer.appendChild(z);
        me.els.push(z);
        const frames = [];
        const drift = rand(0.25, 0.4) * u, rise = rand(0.5, 0.7) * u, sway = u * 0.06, phase = rand(0, Math.PI);
        for (let i = 0; i <= 10; i++) {
          const p = i / 10;
          const x = zx + drift * p + Math.sin(phase + p * Math.PI * 2.2) * sway;
          const y = zy - rise * p;
          frames.push({
            transform: `translate(${x}px, ${y}px) rotate(${Math.sin(phase + p * 6) * 18}deg) scale(${0.4 + p * 1.1})`,
            opacity: p < 0.15 ? p / 0.15 : p > 0.7 ? (1 - p) / 0.3 : 1,
          });
        }
        z.animate(frames, { duration: 3200, easing: 'linear' }).finished.finally(() => z.remove());
        me.timers.push(setTimeout(puff, 650));
      };
      puff();
      me.asleep = true;
      scheduleEnd(me);
    }

    // Réveil : tout disparaît en douceur (immédiat si on enchaîne un nouveau dodo)
    function stop(target = run, instant = false) {
      if (!target || target !== run) return;
      run = null;
      target.waking = true;
      clearTimeout(target.endTimer);
      target.timers.forEach(clearTimeout);
      const remove = () => target.els.forEach((e) => e.remove());
      if (instant) { target.cancelled = true; target.anims.forEach((a) => a.cancel()); return remove(); }
      setTimeout(() => (target.cancelled = true), 0);
      for (const e of target.els) {
        if (!e.isConnected || e.classList.contains('fx-z')) continue;
        e.animate([{ opacity: 1, translate: '0 0' }, { opacity: 0, translate: `0 ${(cfg.sleepSize || 320) * 0.4}px` }],
          { duration: 900, easing: 'ease-in', fill: 'forwards' });
      }
      setTimeout(remove, 950);
    }

    return { start, stop: () => stop(), setAuto, setFace, get active() { return run; } };
  })();

  // ---------- Messages ----------
  window.addEventListener('overlay:msg', (e) => {
    const d = e.detail;
    if (d.type === 'state') { applyState(d.state); applySleep(d.state); }
    else if (d.type === 'fx') {
      if (d.effect === 'cat' || d.effect === 'dog') {
        preload();
        spawnPet(d.effect);
      } else if (d.effect === 'matrix') matrix.burst();
      else if (d.effect === 'fireworks') fireworks.show(8000);
      else if (d.effect === 'birthday') birthday(d.name);
      else if (d.effect === 'sleep') sleeper.start(sleepMs(), false);
      else if (d.effect === 'wake') sleeper.stop();
    }
  });
  // Photo du personnage + dodo automatique tant que le mode AFK est actif
  let faceVersion = null;
  let prevMode = null;
  const sleepMs = () => (cfg.sleepUnlimited ? 0 : cfg.sleepSec * 1000);
  function applySleep(state) {
    const v = (state && state.avatar && state.avatar.version) || 0;
    if (v !== faceVersion) { faceVersion = v; sleeper.setFace(v ? `/api/avatar?v=${v}` : ''); }
    const mode = state && state.mode;
    const cur = sleeper.active;
    if (prevMode === 'afk' && mode !== 'afk') {
      // on quitte l'AFK : réveil, ou le dodo continue comme un dodo lancé à la main
      if (cur && cfg.sleepWakeAfk) sleeper.stop();
      else if (cur && cur.auto) sleeper.setAuto(false, sleepMs());
    } else if (mode === 'afk' && cfg.sleepAfk) {
      if (!cur) sleeper.start(0, true);
      else if (!cur.auto) sleeper.setAuto(true); // déjà endormi : on dort tant que l'AFK dure
    } else if (cur && cur.auto && !cfg.sleepAfk) {
      sleeper.stop(); // option AFK coupée pendant le dodo
    }
    prevMode = mode;
  }
  if (window.__overlayLastState) { applyState(window.__overlayLastState.state); applySleep(window.__overlayLastState.state); }

  // Test rapide sans serveur : overlay?preview=1&fx=cat|dog|matrix|fireworks|birthday|sleep[&name=Alice]
  const test = params.get('fx');
  if (test === 'matrix') matrix.burst(60000);
  else if (test === 'fireworks') fireworks.show(60000);
  else if (test === 'birthday') birthday(params.get('name') || 'Alice', 60000);
  else if (test === 'sleep') sleeper.start(60000, false);
  else if (test === 'cat' || test === 'dog') {
    const moves = MOVES[test].map(([m]) => m);
    moves.forEach((m, i) => setTimeout(() => spawnPet(test, m), i * 400));
  }
})();
