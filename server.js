const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (_, r) => r.type('text').send('ok'));

const W = 1000, H = 520, GRAV = 0.22, HOLD_MS = 120000;

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

/* ---------------- UNO DECK ---------------- */
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
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0;[a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------------- ROOMS ---------------- */
const rooms = new Map();
function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, {
    id, pin: null, players: [], chat: [], mode: 'lobby',
    shot: null, uno: null, find: null, score: {}, timers: {}
  });
  return rooms.get(id);
}
const byCid = (room, cid) => room.players.find(p => p.cid === cid);
const sidOf = (room, cid) => (byCid(room, cid) || {}).sid;

function pub(room) {
  const st = {
    id: room.id, mode: room.mode, score: room.score, locked: !!room.pin,
    players: room.players.map(p => ({ cid: p.cid, name: p.name, online: !!p.sid })),
    chat: room.chat.slice(-40)
  };
  if (room.shot) st.shot = { seed: room.shot.seed, craters: room.shot.craters, turn: room.shot.turn, wind: room.shot.wind, hp: room.shot.hp, pos: room.shot.pos, over: room.shot.over || null };
  if (room.uno) st.uno = { turn: room.uno.turn, color: room.uno.color, top: room.uno.discard[room.uno.discard.length - 1], counts: room.players.map(p => (room.uno.hands[p.cid] || []).length), deck: room.uno.deck.length, over: room.uno.over || null };
  if (room.find) st.find = { nums: room.find.nums, target: room.find.target, round: room.find.round, pts: room.find.pts, over: room.find.over || null };
  return st;
}
function push(room) {
  io.to(room.id).emit('state', pub(room));
  if (room.uno) for (const p of room.players) if (p.sid) io.to(p.sid).emit('hand', room.uno.hands[p.cid] || []);
}
function say(room, text, who = 'SYS') {
  room.chat.push({ who, text, t: Date.now() });
  if (room.chat.length > 80) room.chat.shift();
}

/* ---------------- SHOT ---------------- */
const newWind = () => Math.round(Math.random() * 120 - 60);
function startShot(room) {
  const seed = Math.random(), craters = [], xs = [140, 860];
  room.shot = { seed, craters, turn: 0, wind: newWind(), hp: {}, pos: {} };
  room.players.forEach((pl, i) => {
    const x = xs[i] ?? 500;
    room.shot.hp[pl.cid] = 100;
    room.shot.pos[pl.cid] = { x, y: terrainY(x, seed, craters) };
  });
  room.mode = 'shot';
  say(room, 'เริ่มรอบใหม่: ยิงหิน | ลม ' + room.shot.wind);
}
function runPath(st, s, B, room, out) {
  const pts = [{ x: Math.round(st.x), y: Math.round(st.y) }];
  let x = st.x, y = st.y, vx = st.vx, vy = st.vy, splitDone = !!st.noSplit;
  for (let t = 0; t < 1600; t++) {
    vx += s.wind * 0.00018 * B.wind; vy += GRAV; x += vx; y += vy;
    if (t % 2 === 0) pts.push({ x: Math.round(x), y: Math.round(y) });
    if (!splitDone && B.split && vy > 0 && t > 10) {
      splitDone = true;
      out.queue.push({ x, y, vx: vx * 0.78, vy: vy * 0.9, owner: st.owner, noSplit: true });
      out.queue.push({ x, y, vx: vx * 1.22, vy: vy * 0.95, owner: st.owner, noSplit: true });
    }
    if (x < -400 || x > W + 400 || y > H + 250) break;
    let hit = null;
    for (const pl of room.players) {
      if (pl.cid === st.owner) continue;
      const p = s.pos[pl.cid]; if (!p) continue;
      if (Math.hypot(x - p.x, y - (p.y - 10)) < 17) { hit = pl.cid; break; }
    }
    if (hit || y >= terrainY(x, s.seed, s.craters)) { out.blasts.push({ x, y, r: B.r, dmg: B.dmg, direct: !!hit }); break; }
  }
  out.paths.push(pts);
}
function doFire(room, cid, angle, power, ballKey) {
  const s = room.shot, B = BALLS[ballKey] || BALLS.STD;
  const me = s.pos[cid]; if (!me) return;
  const idx = room.players.findIndex(p => p.cid === cid), dir = idx === 0 ? 1 : -1;
  angle = Math.max(1, Math.min(89, angle)); power = Math.max(5, Math.min(100, power));
  const rad = angle * Math.PI / 180, v = power * 0.185;
  const out = { paths: [], blasts: [], queue: [] };
  out.queue.push({ x: me.x, y: me.y - 16, vx: Math.cos(rad) * v * dir, vy: -Math.sin(rad) * v, owner: cid });
  let guard = 0;
  while (out.queue.length && guard++ < 8) runPath(out.queue.shift(), s, B, room, out);

  const dmgLog = [];
  for (const b of out.blasts) {
    s.craters.push({ x: b.x, y: b.y, r: b.r * 0.85 });
    for (const pl of room.players) {
      const p = s.pos[pl.cid]; if (!p) continue;
      const d = Math.hypot(b.x - p.x, b.y - (p.y - 10));
      if (d < b.r) {
        const dm = Math.round(b.dmg * (1 - d / b.r) * (b.direct ? 1.25 : 1));
        if (dm > 0) { s.hp[pl.cid] = Math.max(0, s.hp[pl.cid] - dm); dmgLog.push({ cid: pl.cid, dm }); }
      }
    }
  }
  for (const pl of room.players) if (s.pos[pl.cid]) s.pos[pl.cid].y = terrainY(s.pos[pl.cid].x, s.seed, s.craters);

  const dead = room.players.find(p => s.hp[p.cid] <= 0);
  if (dead) {
    const win = room.players.find(p => p.cid !== dead.cid);
    if (win) { room.score[win.cid] = (room.score[win.cid] || 0) + 1; s.over = win.cid; say(room, 'จบรอบ — ' + win.name + ' ชนะ'); }
  } else { s.turn = (s.turn + 1) % room.players.length; s.wind = newWind(); }
  io.to(room.id).emit('shot:result', { paths: out.paths, blasts: out.blasts, by: cid, ball: B.key, dmg: dmgLog, angle, power });
  push(room);
}

/* ---------------- UNO ---------------- */
function drawFrom(u, n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!u.deck.length) { const top = u.discard.pop(); u.deck = shuffle(u.discard); u.discard = [top]; }
    if (u.deck.length) got.push(u.deck.pop());
  }
  return got;
}
function startUno(room) {
  const deck = shuffle(buildDeck());
  const u = { deck, discard: [], hands: {}, turn: 0, color: 'R' };
  room.players.forEach(p => { u.hands[p.cid] = deck.splice(0, 7); });
  let first = deck.pop();
  while (first.c === 'W') { deck.unshift(first); first = deck.pop(); }
  u.discard.push(first); u.color = first.c;
  room.uno = u; room.mode = 'uno';
  say(room, 'เริ่มรอบใหม่: UNO');
}

/* ---------------- FIND ---------------- */
function nextFind(room) {
  const set = new Set();
  while (set.size < 48) set.add(1000 + ((Math.random() * 9000) | 0));
  room.find.nums = [...set];
  room.find.target = room.find.nums[(Math.random() * 48) | 0];
  room.find.lock = {};
}
function startFind(room) {
  room.find = { nums: [], target: 0, round: 1, pts: {}, lock: {} };
  room.players.forEach(p => room.find.pts[p.cid] = 0);
  nextFind(room);
  room.mode = 'find';
  say(room, 'เริ่มรอบใหม่: FIND');
}

/* ---------------- SOCKET ---------------- */
io.on('connection', socket => {
  let room = null, CID = null;

  socket.on('join', ({ roomId, name, cid, pin }) => {
    roomId = String(roomId || 'SA-EX-260096').toUpperCase().slice(0, 24);
    cid = String(cid || '').slice(0, 40) || 'c' + Math.random().toString(36).slice(2);
    pin = String(pin || '').trim().slice(0, 12);
    const r = getRoom(roomId);
    const existing = byCid(r, cid);

    if (!existing) {
      if (r.players.length === 0) r.pin = pin || null;          // คนแรกตั้ง PIN
      else if (r.pin && r.pin !== pin) { socket.emit('denied', 'PIN ไม่ถูกต้อง'); return; }
      if (r.players.length >= 2) { socket.emit('denied', 'ห้องเต็มแล้ว'); return; }
      r.players.push({ cid, sid: socket.id, name: (name || 'PLAYER').slice(0, 14) });
      r.score[cid] = r.score[cid] || 0;
      say(r, (name || 'PLAYER') + ' เข้าห้องแล้ว');
    } else {
      if (r.pin && r.pin !== pin) { socket.emit('denied', 'PIN ไม่ถูกต้อง'); return; }
      existing.sid = socket.id;
      if (name) existing.name = name.slice(0, 14);
      if (r.timers[cid]) { clearTimeout(r.timers[cid]); delete r.timers[cid]; }
    }
    room = r; CID = cid;
    socket.join(roomId);
    socket.emit('me', { cid, room: roomId, locked: !!r.pin });
    push(r);
  });

  socket.on('chat', text => {
    if (!room) return;
    const p = byCid(room, CID);
    say(room, String(text).slice(0, 200), p ? p.name : 'GUEST');
    push(room);
  });

  socket.on('start', game => {
    if (!room) return;
    if (room.players.length < 2) { say(room, 'ต้องมี 2 คนถึงจะเริ่มได้'); push(room); return; }
    if (game === 'shot') startShot(room);
    else if (game === 'uno') startUno(room);
    else if (game === 'find') startFind(room);
    push(room);
  });

  socket.on('fire', ({ angle, power, ball }) => {
    if (!room || room.mode !== 'shot' || room.shot.over) return;
    if (room.players[room.shot.turn]?.cid !== CID) return;
    doFire(room, CID, +angle || 45, +power || 60, BALLKEYS.includes(ball) ? ball : 'STD');
  });

  socket.on('uno:play', ({ id, color }) => {
    if (!room || room.mode !== 'uno' || room.uno.over) return;
    const u = room.uno;
    if (room.players[u.turn]?.cid !== CID) return;
    const hand = u.hands[CID]; if (!hand) return;
    const i = hand.findIndex(c => c.id === id); if (i < 0) return;
    const card = hand[i], top = u.discard[u.discard.length - 1];
    if (!(card.c === 'W' || card.c === u.color || card.v === top.v)) { socket.emit('warn', 'ลงใบนี้ไม่ได้'); return; }
    hand.splice(i, 1); u.discard.push(card);
    u.color = card.c === 'W' ? (COLORS.includes(color) ? color : 'R') : card.c;
    const opp = room.players[(u.turn + 1) % room.players.length];
    if (card.v === 'D2' && opp) u.hands[opp.cid].push(...drawFrom(u, 2));
    if (card.v === 'W4' && opp) u.hands[opp.cid].push(...drawFrom(u, 4));
    if (!hand.length) {
      room.score[CID] = (room.score[CID] || 0) + 1; u.over = CID;
      say(room, 'จบรอบ — ' + (byCid(room, CID) || {}).name + ' ชนะ');
      push(room); return;
    }
    if (!['S', 'R', 'D2', 'W4'].includes(card.v)) u.turn = (u.turn + 1) % room.players.length;
    push(room);
  });

  socket.on('uno:draw', () => {
    if (!room || room.mode !== 'uno' || room.uno.over) return;
    const u = room.uno;
    if (room.players[u.turn]?.cid !== CID) return;
    u.hands[CID].push(...drawFrom(u, 1));
    u.turn = (u.turn + 1) % room.players.length;
    push(room);
  });

  socket.on('find:pick', n => {
    if (!room || room.mode !== 'find' || room.find.over) return;
    const f = room.find;
    if (f.lock[CID] && Date.now() < f.lock[CID]) return;
    if (+n === f.target) {
      f.pts[CID] = (f.pts[CID] || 0) + 1;
      if (f.round >= 7) {
        f.over = Object.entries(f.pts).sort((a, b) => b[1] - a[1])[0][0];
        room.score[f.over] = (room.score[f.over] || 0) + 1;
        say(room, 'จบรอบ FIND');
      } else { f.round++; nextFind(room); }
    } else f.lock[CID] = Date.now() + 1500;
    push(room);
  });

  socket.on('disconnect', () => {
    if (!room || !CID) return;
    const p = byCid(room, CID); if (!p) return;
    p.sid = null;
    const rm = room, cid = CID;
    rm.timers[cid] = setTimeout(() => {
      rm.players = rm.players.filter(x => x.cid !== cid);
      delete rm.timers[cid];
      if (!rm.players.length) rooms.delete(rm.id);
      else { say(rm, 'ผู้เล่นออกจากห้อง'); push(rm); }
    }, HOLD_MS);
    push(rm);
  });
});

server.listen(process.env.PORT || 3000, () => console.log('up'));
