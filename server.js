const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, r) => r.type('text').send('ok'));

const W = 1000, H = 520, GRAV = 0.22;

function terrainY(x, seed, craters) {
  const a = seed * 6.283, b = seed * 11.7, c = seed * 3.1;
  let y = 380 + 45 * Math.sin(x * 0.0065 + a) + 26 * Math.sin(x * 0.019 + b) + 11 * Math.sin(x * 0.043 + c);
  if (craters) for (const cr of craters) {
    const d = Math.abs(x - cr.x);
    if (d < cr.r) y += Math.sqrt(cr.r * cr.r - d * d) * 0.55;
  }
  return Math.max(120, Math.min(H - 4, y));
}

const BALLS = {
  STD:   { key:'STD',   name:'หินธรรมดา',  code:'DF20ARL', dmg:24, r:36, wind:1.0 },
  HEAVY: { key:'HEAVY', name:'หินก้อนใหญ่', code:'DF30ATL', dmg:36, r:50, wind:0.45 },
  SPLIT: { key:'SPLIT', name:'หินแตกสาม',  code:'DF25ATL', dmg:15, r:30, wind:1.1, split:true },
  DRILL: { key:'DRILL', name:'หินเจาะ',    code:'DT30RS',  dmg:30, r:20, wind:0.7 }
};
const BALLKEYS = Object.keys(BALLS);

/* ---------- UNO ---------- */
const COLORS = ['R', 'G', 'B', 'Y'];
function buildDeck() {
  const d = []; let id = 0;
  for (const c of COLORS) {
    d.push({ id: id++, c, v: '0' });
    for (let n = 1; n <= 9; n++) { d.push({ id: id++, c, v: '' + n }); d.push({ id: id++, c, v: '' + n }); }
    for (const s of ['S', 'R', 'D2']) { d.push({ id: id++, c, v: s }); d.push({ id: id++, c, v: s }); }
  }
  for (let i = 0; i < 4; i++) { d.push({ id: id++, c: 'W', v: 'W' }); d.push({ id: id++, c: 'W', v: 'W4' }); }
  return d;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; }

/* ---------- ROOMS ---------- */
const rooms = new Map();
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, { id, players: [], chat: [], mode: 'lobby', shot: null, uno: null, find: null, score: {} });
  return rooms.get(id);
}
function pub(room) {
  const st = {
    id: room.id, mode: room.mode, score: room.score,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    chat: room.chat.slice(-40)
  };
  if (room.shot) st.shot = { seed: room.shot.seed, craters: room.shot.craters, turn: room.shot.turn, wind: room.shot.wind, hp: room.shot.hp, pos: room.shot.pos, over: room.shot.over || null };
  if (room.uno) st.uno = { turn: room.uno.turn, color: room.uno.color, top: room.uno.discard[room.uno.discard.length - 1], counts: room.players.map(p => (room.uno.hands[p.id] || []).length), deck: room.uno.deck.length, over: room.uno.over || null, pending: room.uno.pending || null };
  if (room.find) st.find = { nums: room.find.nums, target: room.find.target, round: room.find.round, pts: room.find.pts, over: room.find.over || null };
  return st;
}
function push(room) {
  io.to(room.id).emit('state', pub(room));
  if (room.uno) for (const p of room.players) io.to(p.id).emit('hand', room.uno.hands[p.id] || []);
}
function say(room, text, who = 'SYS') {
  room.chat.push({ who, text, t: Date.now() });
  if (room.chat.length > 80) room.chat.shift();
}

/* ---------- SHOT ---------- */
function newWind() { return Math.round((Math.random() * 120 - 60)); }
function startShot(room) {
  const seed = Math.random(), craters = [], xs = [140, 860];
  room.shot = { seed, craters, turn: 0, wind: newWind(), hp: {}, pos: {} };
  room.players.forEach((pl, i) => {
    const x = xs[i] ?? 500;
    room.shot.hp[pl.id] = 100;
    room.shot.pos[pl.id] = { x, y: terrainY(x, seed, craters) };
  });
  room.mode = 'shot';
  say(room, 'เริ่มรอบใหม่: ยิงหิน | ลม ' + room.shot.wind);
}
function runPath(st, s, B, room, out) {
  const pts = [{ x: Math.round(st.x), y: Math.round(st.y) }];
  let x = st.x, y = st.y, vx = st.vx, vy = st.vy, splitDone = !!st.noSplit;
  for (let t = 0; t < 1600; t++) {
    vx += s.wind * 0.00018 * B.wind;
    vy += GRAV;
    x += vx; y += vy;
    if (t % 2 === 0) pts.push({ x: Math.round(x), y: Math.round(y) });
    if (!splitDone && B.split && vy > 0 && t > 10) {
      splitDone = true;
      out.queue.push({ x, y, vx: vx * 0.78, vy: vy * 0.9, owner: st.owner, noSplit: true });
      out.queue.push({ x, y, vx: vx * 1.22, vy: vy * 0.95, owner: st.owner, noSplit: true });
    }
    if (x < -400 || x > W + 400 || y > H + 250) break;
    let hit = null;
    for (const pl of room.players) {
      if (pl.id === st.owner) continue;
      const p = s.pos[pl.id]; if (!p) continue;
      if (Math.hypot(x - p.x, y - (p.y - 10)) < 17) { hit = pl.id; break; }
    }
    if (hit || y >= terrainY(x, s.seed, s.craters)) { out.blasts.push({ x, y, r: B.r, dmg: B.dmg, direct: !!hit }); break; }
  }
  out.paths.push(pts);
}
function doFire(room, shooterId, angle, power, ballKey) {
  const s = room.shot, B = BALLS[ballKey] || BALLS.STD;
  const me = s.pos[shooterId];
  const idx = room.players.findIndex(p => p.id === shooterId);
  const dir = idx === 0 ? 1 : -1;
  angle = Math.max(1, Math.min(89, angle)); power = Math.max(5, Math.min(100, power));
  const rad = angle * Math.PI / 180, v = power * 0.185;
  const out = { paths: [], blasts: [], queue: [] };
  out.queue.push({ x: me.x, y: me.y - 16, vx: Math.cos(rad) * v * dir, vy: -Math.sin(rad) * v, owner: shooterId });
  let guard = 0;
  while (out.queue.length && guard++ < 8) runPath(out.queue.shift(), s, B, room, out);

  const dmgLog = [];
  for (const b of out.blasts) {
    s.craters.push({ x: b.x, y: b.y, r: b.r * 0.85 });
    for (const pl of room.players) {
      const p = s.pos[pl.id];
      const d = Math.hypot(b.x - p.x, b.y - (p.y - 10));
      if (d < b.r) {
        let dm = Math.round(b.dmg * (1 - d / b.r) * (b.direct ? 1.25 : 1));
        if (dm > 0) { s.hp[pl.id] = Math.max(0, s.hp[pl.id] - dm); dmgLog.push({ id: pl.id, dm }); }
      }
    }
  }
  for (const pl of room.players) s.pos[pl.id].y = terrainY(s.pos[pl.id].x, s.seed, s.craters);

  const dead = room.players.find(p => s.hp[p.id] <= 0);
  if (dead) {
    const win = room.players.find(p => p.id !== dead.id);
    if (win) { room.score[win.id] = (room.score[win.id] || 0) + 1; s.over = win.id; say(room, 'จบรอบ — ' + win.name + ' ชนะ'); }
  } else {
    s.turn = (s.turn + 1) % room.players.length;
    s.wind = newWind();
  }
  io.to(room.id).emit('shot:result', { paths: out.paths, blasts: out.blasts, by: shooterId, ball: B.key, dmg: dmgLog, angle, power });
  push(room);
}

/* ---------- UNO ---------- */
function drawFrom(u, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!u.deck.length) {
      const top = u.discard.pop();
      u.deck = shuffle(u.discard.map(c => (c.c === 'W' ? { ...c, c: 'W' } : c)));
      u.discard = [top];
    }
    if (u.deck.length) got.push(u.deck.pop());
  }
  return got;
}
function startUno(room) {
  const deck = shuffle(buildDeck());
  const u = { deck, discard: [], hands: {}, turn: 0, color: 'R' };
  room.players.forEach(p => { u.hands[p.id] = deck.splice(0, 7); });
  let first = deck.pop();
  while (first.c === 'W') { deck.unshift(first); first = deck.pop(); }
  u.discard.push(first); u.color = first.c;
  room.uno = u; room.mode = 'uno';
  say(room, 'เริ่มรอบใหม่: UNO');
}
function unoWin(room, pid) {
  room.score[pid] = (room.score[pid] || 0) + 1;
  room.uno.over = pid;
  const p = room.players.find(x => x.id === pid);
  say(room, 'จบรอบ — ' + (p ? p.name : '?') + ' ชนะ');
}

/* ---------- FIND ---------- */
function startFind(room) {
  room.find = { nums: [], target: 0, round: 1, pts: {}, lock: {} };
  room.players.forEach(p => room.find.pts[p.id] = 0);
  nextFind(room);
  room.mode = 'find';
  say(room, 'เริ่มรอบใหม่: FIND — หาเลขเป้าหมายให้ไวที่สุด');
}
function nextFind(room) {
  const set = new Set();
  while (set.size < 48) set.add(1000 + ((Math.random() * 9000) | 0));
  room.find.nums = [...set];
  room.find.target = room.find.nums[(Math.random() * 48) | 0];
  room.find.lock = {};
}

/* ---------- SOCKET ---------- */
io.on('connection', socket => {
  let room = null;

  socket.on('join', ({ roomId, name }) => {
    roomId = String(roomId || 'SA-EX-260096').toUpperCase().slice(0, 24);
    room = getRoom(roomId);
    socket.join(roomId);
    if (room.players.length < 2) {
      room.players.push({ id: socket.id, name: (name || 'PLAYER').slice(0, 14) });
      room.score[socket.id] = room.score[socket.id] || 0;
      say(room, (name || 'PLAYER') + ' เข้าห้องแล้ว');
    }
    socket.emit('me', { id: socket.id, room: roomId });
    push(room);
  });

  socket.on('chat', text => {
    if (!room) return;
    const p = room.players.find(x => x.id === socket.id);
    say(room, String(text).slice(0, 200), p ? p.name : 'GUEST');
    push(room);
  });

  socket.on('start', game => {
    if (!room || room.players.length < 2) { if (room) { say(room, 'ต้องมี 2 คนถึงจะเริ่มได้'); push(room); } return; }
    if (game === 'shot') startShot(room);
    else if (game === 'uno') startUno(room);
    else if (game === 'find') startFind(room);
    push(room);
  });

  socket.on('aim', a => { if (room) socket.to(room.id).emit('aim', { id: socket.id, ...a }); });

  socket.on('fire', ({ angle, power, ball }) => {
    if (!room || room.mode !== 'shot' || room.shot.over) return;
    if (room.players[room.shot.turn]?.id !== socket.id) return;
    doFire(room, socket.id, +angle || 45, +power || 60, BALLKEYS.includes(ball) ? ball : 'STD');
  });

  socket.on('uno:play', ({ id, color }) => {
    if (!room || room.mode !== 'uno' || room.uno.over) return;
    const u = room.uno;
    if (room.players[u.turn]?.id !== socket.id) return;
    const hand = u.hands[socket.id];
    const i = hand.findIndex(c => c.id === id); if (i < 0) return;
    const card = hand[i], top = u.discard[u.discard.length - 1];
    const legal = card.c === 'W' || card.c === u.color || card.v === top.v;
    if (!legal) { socket.emit('warn', 'ลงใบนี้ไม่ได้'); return; }
    hand.splice(i, 1); u.discard.push(card);
    u.color = card.c === 'W' ? (COLORS.includes(color) ? color : 'R') : card.c;
    const opp = room.players[(u.turn + 1) % room.players.length];
    if (card.v === 'D2' && opp) u.hands[opp.id].push(...drawFrom(u, 2));
    if (card.v === 'W4' && opp) u.hands[opp.id].push(...drawFrom(u, 4));
    if (!hand.length) { unoWin(room, socket.id); push(room); return; }
    const skip = ['S', 'R', 'D2', 'W4'].includes(card.v);
    if (!skip) u.turn = (u.turn + 1) % room.players.length;
    push(room);
  });

  socket.on('uno:draw', () => {
    if (!room || room.mode !== 'uno' || room.uno.over) return;
    const u = room.uno;
    if (room.players[u.turn]?.id !== socket.id) return;
    u.hands[socket.id].push(...drawFrom(u, 1));
    u.turn = (u.turn + 1) % room.players.length;
    push(room);
  });

  socket.on('find:pick', n => {
    if (!room || room.mode !== 'find' || room.find.over) return;
    const f = room.find;
    if (f.lock[socket.id] && Date.now() < f.lock[socket.id]) return;
    if (+n === f.target) {
      f.pts[socket.id] = (f.pts[socket.id] || 0) + 1;
      if (f.round >= 7) {
        f.over = Object.entries(f.pts).sort((a, b) => b[1] - a[1])[0][0];
        room.score[f.over] = (room.score[f.over] || 0) + 1;
        say(room, 'จบรอบ FIND');
      } else { f.round++; nextFind(room); }
    } else { f.lock[socket.id] = Date.now() + 1500; }
    push(room);
  });

  socket.on('disconnect', () => {
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    say(room, 'ผู้เล่นออกจากห้อง');
    if (!room.players.length) rooms.delete(room.id); else push(room);
  });
});

server.listen(process.env.PORT || 3000, () => console.log('up'));
