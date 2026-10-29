// Serveur de pilotage d'overlay OBS
// - Sert le dashboard (/) et l'overlay (/overlay)
// - WebSocket (/ws) : le dashboard envoie des commandes, tous les clients reçoivent l'état
// - API HTTP simple (/api/...) pour Stream Deck / raccourcis

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
// 0.0.0.0 = accessible depuis le réseau local (tablette, téléphone). HOST=127.0.0.1 pour limiter à ce PC.
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
// Toute la configuration est sauvegardée dans ce fichier JSON (STATE_FILE pour le changer)
const STATE_FILE = path.resolve(process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json'));
const BACKUP_FILE = STATE_FILE.replace(/\.json$/, '') + '.backup.json';

const MODES = ['focus', 'help', 'afk', 'open'];

const DEFAULT_STATE = {
  mode: 'focus',
  modes: {
    focus: { label: 'FOCUS TIME', subtitle: 'Deep work en cours', accent: '' },
    help: { label: 'HELP THE CREW', subtitle: 'Posez vos questions dans le chat', accent: '' },
    afk: { label: 'AFK', subtitle: 'Je reviens vite', accent: '' },
    open: { label: 'OPEN TO DISCUSS', subtitle: 'On discute, lance un sujet dans le chat', accent: '' },
  },
  timer: { running: false, endsAt: null, remainingMs: 25 * 60000, durationMs: 25 * 60000, label: 'Session' },
  message: {
    text: '',
    maxLines: 2, // lignes autorisées avant défilement (ou coupure)
    scroll: 'auto', // auto (si trop long) | always | off (coupé avec …)
    speed: 110, // px/s
    direction: 'left', // left | right
  },
  style: {
    fontDisplay: 'Orbitron',
    fontBody: 'Inter',
    fontWeight: 700,
    scale: 1,
    messageSize: 30,
    uppercase: true,
    position: 'bottom-left',
    textColor: '#ffffff',
    panelWidth: 0, // px, 0 = automatique
    panelHeight: 0, // px, 0 = automatique
  },
  visibility: { panel: true, mode: true, timer: true, message: true },
  fx: {
    cats: false, // chatons qui apparaissent au hasard
    dogs: false, // chiens qui apparaissent au hasard
    petMinSec: 30, // intervalle aléatoire entre deux apparitions
    petMaxSec: 90,
    petSize: 180, // px
    matrix: false, // pluie Matrix en continu (derrière le panneau)
    matrixOpacity: 0.35,
    matrixColor: '#00ff66',
    matrixSpeed: 1,
  },
  // Contour global de l'écran, aux couleurs du mode
  border: {
    enabled: false,
    thickness: 8, // px
    style: 'flow', // flow (lumière qui tourne) | pulse | static
    speed: 1,
    glow: 0.6, // halo 0..1
    radius: 0, // coins arrondis (px)
    modes: { focus: true, help: true, afk: true, open: true }, // modes où le contour s'affiche
  },
  // Voile flou "verre dépoli" (sous tous les éléments de l'overlay)
  veil: {
    enabled: true,
    opacity: 0.8, // couverture 0..1
    tint: 0.5, // part de la couleur du mode 0..1
    grain: true,
    motion: true, // halos qui dérivent lentement
    modes: { focus: false, help: false, afk: true, open: false },
  },
  // Calque de lumière teintée selon le mode
  tint: {
    enabled: false,
    style: 'vignette', // vignette | wash | leaks
    intensity: 0.35,
    motion: true,
    modes: { focus: true, help: true, afk: true, open: true },
  },
  // Son joué quand le compte à rebours arrive à zéro
  alarm: {
    enabled: true,
    sound: 'chime', // chime | bell | beep | gong
    volume: 0.7,
    repeat: 2, // nombre de fois que le motif est joué
    output: 'overlay', // overlay (OBS) | dashboard | both
  },
  deck: { keySize: 96 },
  // Profils : instantanés nommés des réglages (voir PROFILE_KEYS), rappelables en un clic
  profiles: [], // [{ name, data, savedAt }]
  activeProfile: '', // dernier profil appliqué ou enregistré // taille des touches du deck (px)
  // Listes réutilisables (partagées entre dashboard et deck)
  library: {
    quickMessages: [],
    birthdayNames: [],
  },
};

// Sections enregistrées dans un profil (+ le mode de travail). Ne touche pas au timer ni au texte du message.
const PROFILE_KEYS = ['modes', 'style', 'visibility', 'fx', 'border', 'veil', 'tint', 'alarm', 'message'];
const FX_TRIGGERS = ['cat', 'dog', 'matrix', 'fireworks', 'birthday', 'alarm']; // alarm = tester le son de fin

// ---------- État ----------

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

// Fusion récursive limitée aux clés connues du modèle (ignore tout le reste)
function mergeKnown(target, patch, model) {
  for (const key of Object.keys(patch || {})) {
    if (!(key in model)) continue;
    const val = patch[key];
    if (isObject(model[key])) {
      if (isObject(val)) mergeKnown(target[key], val, model[key]);
    } else if (Array.isArray(model[key])) {
      if (Array.isArray(val)) target[key] = val;
    } else if (model[key] === null || typeof val === typeof model[key]) {
      target[key] = val;
    }
  }
  return target;
}

function readStateFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadState() {
  const state = structuredClone(DEFAULT_STATE);
  let saved = null;
  if (fs.existsSync(STATE_FILE)) {
    try {
      saved = readStateFile(STATE_FILE);
      // Copie de sécurité de la dernière config valide, à chaque démarrage
      fs.copyFileSync(STATE_FILE, BACKUP_FILE);
    } catch (err) {
      // Fichier abîmé : on le met de côté (jamais écrasé) et on tente la copie de sécurité
      const broken = STATE_FILE.replace(/\.json$/, '') + `.broken-${Date.now()}.json`;
      fs.renameSync(STATE_FILE, broken);
      console.error(`Config illisible (${err.message}), mise de côté : ${broken}`);
      try {
        saved = readStateFile(BACKUP_FILE);
        console.log(`Config restaurée depuis ${BACKUP_FILE}`);
      } catch {
        console.error('Aucune copie de sécurité valide : configuration par défaut.');
      }
    }
  }
  if (saved) mergeKnown(state, saved, DEFAULT_STATE);
  // Un timer qui tournait avant l'arrêt du serveur est repris s'il n'a pas expiré
  if (state.timer.running && !(state.timer.endsAt > Date.now())) {
    Object.assign(state.timer, { running: false, endsAt: null, remainingMs: 0 });
  }
  return state;
}

// Écriture atomique : fichier temporaire puis renommage, le JSON n'est jamais à moitié écrit
function writeStateNow() {
  clearTimeout(saveTimeout);
  saveTimeout = null;
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.error('Sauvegarde impossible :', err.message);
  }
}

let saveTimeout = null;
let state = loadState();
clampNumbers();
writeStateNow(); // crée le fichier dès le premier lancement (avec les nouvelles clés éventuelles)

function saveState() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(writeStateNow, 150);
}

// Sauvegarde garantie à l'arrêt (Ctrl+C, kill, fermeture du terminal)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    writeStateNow();
    process.exit(0);
  });
}

function clampNumbers() {
  const s = state.style;
  s.scale = Math.min(2, Math.max(0.5, Number(s.scale) || 1));
  s.messageSize = Math.min(120, Math.max(12, Math.round(Number(s.messageSize) || 30)));
  s.fontWeight = Math.min(900, Math.max(100, Math.round((Number(s.fontWeight) || 700) / 100) * 100));
  // 0 = auto, sinon borné
  const dim = (v, min, max) => (Number(v) > 0 ? Math.min(max, Math.max(min, Math.round(Number(v)))) : 0);
  s.panelWidth = dim(s.panelWidth, 280, 1800);
  s.panelHeight = dim(s.panelHeight, 100, 1000);
  const fx = state.fx;
  fx.petMinSec = Math.min(3600, Math.max(3, Math.round(Number(fx.petMinSec) || 30)));
  fx.petMaxSec = Math.min(3600, Math.max(fx.petMinSec, Math.round(Number(fx.petMaxSec) || 90)));
  fx.petSize = Math.min(600, Math.max(60, Math.round(Number(fx.petSize) || 180)));
  fx.matrixOpacity = Math.min(1, Math.max(0.05, Number(fx.matrixOpacity) || 0.35));
  fx.matrixSpeed = Math.min(3, Math.max(0.2, Number(fx.matrixSpeed) || 1));
  if (!/^#[0-9a-f]{6}$/i.test(fx.matrixColor)) fx.matrixColor = '#00ff66';
  const m = state.message;
  m.maxLines = Math.min(8, Math.max(1, Math.round(Number(m.maxLines) || 2)));
  m.speed = Math.min(400, Math.max(20, Math.round(Number(m.speed) || 110)));
  if (!['auto', 'always', 'off'].includes(m.scroll)) m.scroll = 'auto';
  if (!['left', 'right'].includes(m.direction)) m.direction = 'left';
  const a = state.alarm;
  a.volume = Math.min(1, Math.max(0, Number(a.volume) || 0));
  a.repeat = Math.min(5, Math.max(1, Math.round(Number(a.repeat) || 1)));
  if (!['chime', 'bell', 'beep', 'gong'].includes(a.sound)) a.sound = 'chime';
  if (!['overlay', 'dashboard', 'both'].includes(a.output)) a.output = 'overlay';
  const b = state.border;
  b.thickness = Math.min(60, Math.max(1, Math.round(Number(b.thickness) || 8)));
  b.speed = Math.min(4, Math.max(0.2, Number(b.speed) || 1));
  b.glow = Math.min(1, Math.max(0, Number(b.glow) || 0));
  b.radius = Math.min(80, Math.max(0, Math.round(Number(b.radius) || 0)));
  if (!['flow', 'pulse', 'static'].includes(b.style)) b.style = 'flow';
  const v = state.veil;
  v.opacity = Math.min(1, Math.max(0.05, Number(v.opacity) || 0.8));
  v.tint = Math.min(1, Math.max(0, Number(v.tint) || 0));
  const t = state.tint;
  t.intensity = Math.min(1, Math.max(0.02, Number(t.intensity) || 0.35));
  if (!['vignette', 'wash', 'leaks'].includes(t.style)) t.style = 'vignette';
  state.deck.keySize = Math.min(220, Math.max(56, Math.round(Number(state.deck.keySize) || 96)));
  // listes : chaînes non vides, uniques, longueur et nombre bornés
  const list = (arr, maxLen, maxItems) =>
    [...new Set(arr.filter((v) => typeof v === 'string').map((v) => v.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems);
  state.library.quickMessages = list(state.library.quickMessages, 500, 50);
  state.library.birthdayNames = list(state.library.birthdayNames, 40, 30);
  const seen = new Set();
  state.profiles = state.profiles
    .filter((p) => isObject(p) && typeof p.name === 'string' && p.name.trim() && isObject(p.data))
    .map((p) => ({ name: p.name.trim().slice(0, 40), data: p.data, savedAt: Number(p.savedAt) || 0 }))
    .filter((p) => !seen.has(p.name) && seen.add(p.name))
    .slice(0, 30);
  if (!state.profiles.some((p) => p.name === state.activeProfile)) state.activeProfile = '';
  if (!['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(s.position)) s.position = 'bottom-left';
  if (!MODES.includes(state.mode)) state.mode = 'focus';
}

// ---------- Timer ----------

function remainingNow() {
  const t = state.timer;
  return t.running ? Math.max(0, t.endsAt - Date.now()) : Math.max(0, t.remainingMs);
}

function timerAction(action, ms) {
  const t = state.timer;
  const now = Date.now();
  ms = Number(ms) || 0;

  switch (action) {
    case 'start':
      if (t.running) break;
      if (t.remainingMs <= 0) t.remainingMs = t.durationMs;
      t.endsAt = now + t.remainingMs;
      t.running = true;
      break;
    case 'pause':
      if (!t.running) break;
      t.remainingMs = remainingNow();
      t.endsAt = null;
      t.running = false;
      break;
    case 'toggle':
      return timerAction(t.running ? 'pause' : 'start');
    case 'reset':
      Object.assign(t, { running: false, endsAt: null, remainingMs: t.durationMs });
      break;
    case 'set': // définit une nouvelle durée (timer arrêté)
      if (ms <= 0) return false;
      Object.assign(t, { running: false, endsAt: null, durationMs: ms, remainingMs: ms });
      break;
    case 'add': {
      // ajoute (ou retire si négatif) du temps sans interrompre le timer
      const next = Math.max(0, remainingNow() + ms);
      if (t.running) t.endsAt = now + next;
      else t.remainingMs = next;
      t.durationMs = Math.max(t.durationMs, next);
      break;
    }
    default:
      return false;
  }
  return true;
}

// Arrêt automatique à 0
setInterval(() => {
  const t = state.timer;
  if (t.running && t.endsAt <= Date.now()) {
    Object.assign(t, { running: false, endsAt: null, remainingMs: 0 });
    commit();
  }
}, 200);

// ---------- Diffusion ----------

let wss;

function snapshot() {
  return JSON.stringify({ type: 'state', serverNow: Date.now(), state });
}

function broadcast(data) {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastClients() {
  const counts = { overlay: 0, dashboard: 0 };
  for (const c of wss.clients) if (c.role in counts) counts[c.role]++;
  broadcast(JSON.stringify({ type: 'clients', ...counts }));
}

// Effet ponctuel : n'altère pas l'état, juste diffusé aux overlays
function triggerFx(effect, name) {
  if (!FX_TRIGGERS.includes(effect)) return false;
  // name : prénom pour l'anniversaire (optionnel)
  broadcast(JSON.stringify({ type: 'fx', effect, name: String(name ?? '').trim().slice(0, 40) }));
  return true;
}

function profileData() {
  const data = {};
  for (const k of PROFILE_KEYS) data[k] = structuredClone(state[k]);
  delete data.message.text;
  data.mode = state.mode;
  return data;
}

function applyProfile(name) {
  const p = state.profiles.find((x) => x.name === name);
  if (!p) return false;
  const text = state.message.text;
  // repart des valeurs par défaut : un profil ancien n'hérite pas des réglages du moment
  for (const k of PROFILE_KEYS) state[k] = structuredClone(DEFAULT_STATE[k]);
  const data = {};
  for (const k of PROFILE_KEYS) if (isObject(p.data[k])) data[k] = p.data[k];
  mergeKnown(state, data, DEFAULT_STATE);
  state.message.text = text;
  if (MODES.includes(p.data.mode)) state.mode = p.data.mode; // profils anciens sans mode : mode inchangé
  state.activeProfile = p.name;
  return true;
}

function commit() {
  clampNumbers();
  saveState();
  broadcast(snapshot());
}

// Applique une commande (venant du WebSocket ou de l'API HTTP). Renvoie true si l'état a changé.
function applyCommand(cmd) {
  if (!isObject(cmd)) return false;
  switch (cmd.type) {
    case 'patch':
      mergeKnown(state, cmd.patch, DEFAULT_STATE);
      return true;
    case 'mode':
      if (!MODES.includes(cmd.mode)) return false;
      state.mode = cmd.mode;
      return true;
    case 'timer':
      return timerAction(cmd.action, cmd.ms);
    case 'message':
      state.message.text = String(cmd.text ?? '');
      return true;
    case 'profile-save': {
      const name = String(cmd.name ?? '').trim().slice(0, 40);
      if (!name) return false;
      const entry = { name, data: profileData(), savedAt: Date.now() };
      const i = state.profiles.findIndex((p) => p.name === name);
      if (i >= 0) state.profiles[i] = entry;
      else state.profiles.push(entry);
      state.activeProfile = name;
      return true;
    }
    case 'profile-apply':
      return applyProfile(String(cmd.name ?? ''));
    case 'profile-move': {
      // déplace le profil `name` à la position `index` (0 = premier)
      const from = state.profiles.findIndex((p) => p.name === cmd.name);
      const to = Math.min(state.profiles.length - 1, Math.max(0, Math.round(Number(cmd.index) || 0)));
      if (from < 0 || from === to) return false;
      state.profiles.splice(to, 0, ...state.profiles.splice(from, 1));
      return true;
    }
    case 'profile-delete': {
      const before = state.profiles.length;
      state.profiles = state.profiles.filter((p) => p.name !== cmd.name);
      return state.profiles.length !== before;
    }
    case 'reset-style':
      state.style = structuredClone(DEFAULT_STATE.style);
      return true;
    default:
      return false;
  }
}

// ---------- HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const ROUTES = { '/': 'dashboard.html', '/dashboard': 'dashboard.html', '/overlay': 'overlay.html', '/deck': 'deck.html' };

function sendJson(res, code, body) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, ROUTES[pathname] || pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// API GET pratique pour Stream Deck (action "Website" en arrière-plan) :
//   /api/state
//   /api/mode/focus | help | afk
//   /api/timer/start | pause | toggle | reset
//   /api/timer/set?min=25     /api/timer/add?min=5  (ou ?sec=30)
//   /api/message?text=Hello   (text vide = efface)
//   /api/fx/cat | dog | matrix | fireworks  (effet ponctuel)
//   /api/fx/birthday?name=Alice
//   /api/profile/Nom%20du%20profil  (applique un profil enregistré)
//   /api/config  GET = télécharger la config, POST = importer
function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  if (parts[1] === 'state') return sendJson(res, 200, { serverNow: Date.now(), state });
  if (parts[1] === 'config') return handleConfig(req, res);
  if (parts[1] === 'fx') {
    return triggerFx(parts[2], url.searchParams.get('name')) ? sendJson(res, 200, { ok: true }) : sendJson(res, 400, { error: 'effet inconnu' });
  }

  let cmd = null;
  if (parts[1] === 'mode') cmd = { type: 'mode', mode: parts[2] };
  else if (parts[1] === 'timer') {
    const min = Number(url.searchParams.get('min')) || 0;
    const sec = Number(url.searchParams.get('sec')) || 0;
    cmd = { type: 'timer', action: parts[2], ms: (min * 60 + sec) * 1000 };
  } else if (parts[1] === 'profile') {
    let name = '';
    try { name = decodeURIComponent(parts.slice(2).join('/')); } catch {}
    cmd = { type: 'profile-apply', name };
  } else if (parts[1] === 'message') cmd = { type: 'message', text: url.searchParams.get('text') || '' };

  if (!cmd || !applyCommand(cmd)) return sendJson(res, 400, { error: 'commande invalide' });
  commit();
  sendJson(res, 200, { ok: true, state });
}

// Export (GET) / import (POST) de toute la configuration
function handleConfig(req, res) {
  if (req.method === 'GET') {
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': MIME['.json'],
      'Content-Disposition': `attachment; filename="overlay-config-${stamp}.json"`,
    });
    return res.end(JSON.stringify(state, null, 2));
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) req.destroy();
  });
  req.on('end', () => {
    let imported;
    try {
      imported = JSON.parse(body);
    } catch {
      return sendJson(res, 400, { error: 'JSON invalide' });
    }
    if (!isObject(imported)) return sendJson(res, 400, { error: 'JSON invalide' });
    mergeKnown(state, imported, DEFAULT_STATE);
    commit();
    writeStateNow();
    sendJson(res, 200, { ok: true });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  serveStatic(res, url.pathname);
});

// ---------- WebSocket ----------

wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.role = 'unknown';
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.send(snapshot());

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      ws.role = msg.role === 'overlay' ? 'overlay' : msg.role === 'dashboard' ? 'dashboard' : 'unknown';
      broadcastClients();
      return;
    }
    if (msg.type === 'fx') return void triggerFx(msg.effect, msg.name);
    if (applyCommand(msg)) commit();
  });

  ws.on('close', broadcastClients);
});

// Détecte les connexions mortes (OBS fermé brutalement, etc.)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// Adresses IPv4 du PC sur le réseau local
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function onListenError(err) {
  if (err.code === 'EADDRINUSE') console.error(`\n  Le port ${PORT} est déjà utilisé : un serveur tourne déjà ? (PORT=3001 npm start pour un autre port)\n`);
  else console.error(err);
  process.exit(1);
}
server.on('error', onListenError);
wss.on('error', onListenError); // ws relaie aussi l'erreur d'écoute du serveur HTTP

server.listen(PORT, HOST, () => {
  const local = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  Sur ce PC`);
  console.log(`    Dashboard : ${local}/`);
  console.log(`    Overlay   : ${local}/overlay   (Source Navigateur OBS, 1920x1080)`);
  console.log(`    Deck      : ${local}/deck`);
  if (HOST === '0.0.0.0') {
    const ips = lanAddresses();
    if (ips.length) {
      console.log(`\n  Depuis le réseau local (tablette, téléphone, autre PC)`);
      for (const ip of ips) console.log(`    http://${ip}:${PORT}/   ·   Deck : http://${ip}:${PORT}/deck`);
    }
  } else {
    console.log(`\n  (accès limité à ce PC — retirer HOST=${HOST} pour ouvrir au réseau local)`);
  }
  console.log(`\n  Config    : ${STATE_FILE}\n`);
});
