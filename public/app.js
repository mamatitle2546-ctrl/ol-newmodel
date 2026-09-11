/* ================= SETUP ================= */
const socket = io();
const qs = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer:coarse)').matches;
const STEALTH = qs.get('ui') === 'stealth' ? true : qs.get('ui') === 'full' ? false : !(coarse && innerWidth < 1000);
document.body.classList.add(STEALTH ? 'stealth' : 'full');

const W = 1000, H = 520;
let ME = null, S = null, HAND = [], AIM = { angle: 45, power: 60, ball: 'STD' };
let anim = null, craterFx = [];
const BALLS = {
  STD:   { n: 'หินธรรมดา',  c: 'DF20ARL', col: '#cbd5e1' },
  HEAVY: { n: 'หินก้อนใหญ่', c: 'DF30ATL', col: '#94a3b8' },
  SPLIT: { n: 'หินแตกสาม',  c: 'DF25ATL', col: '#fbbf24' },
  DRILL: { n: 'หินเจาะ',    c: 'DT30RS',  col: '#60a5fa' }
};
const BK = Object.keys(BALLS);
const CCODE = { R: 'E91', G: 'E92', B: 'E93', Y: 'E96', W: 'E95' };
const CNAME = { R: 'แดง', G: 'เขียว', B: 'น้ำเงิน', Y: 'เหลือง', W: 'ไวลด์' };
const VMAP = { S: 'SKE', R: 'RVS', D2: 'PLS', W: 'WLD', W4: 'WL4' };

function terrainY(x, seed, craters) {
  const a = seed * 6.283, b = seed * 11.7, c = seed * 3.1;
  let y = 380 + 45 * Math.sin(x * 0.0065 + a) + 26 * Math.sin(x * 0.019 + b) + 11 * Math.sin(x * 0.043 + c);
  if (craters) for (const cr of craters) { const d = Math.abs(x - cr.x); if (d < cr.r) y += Math.sqrt(cr.r * cr.r - d * d) * 0.55; }
  return Math.max(120, Math.min(H - 4, y));
}
const cardCode = c => c.c === 'W'
  ? `${VMAP[c.v]}-${c.v === 'W4' ? '04' : '00'}AL`
  : `DF${(isNaN(+c.v) ? VMAP[c.v] : String(c.v).padStart(2, '0'))}A${c.c}L`;

/* ================= JOIN ================= */
const jn = document.getElementById('join');
function doJoin(roomId, name) {
  localStorage.olRoom = roomId; localStorage.olName = name;
  socket.emit('join', { roomId, name });
  jn.classList.remove('show');
}
if (localStorage.olRoom && localStorage.olName) doJoin(localStorage.olRoom, localStorage.olName);
else if (STEALTH) doJoin('SA-EX-260096', 'PC'); // คอมเข้าเงียบๆ ไม่มีหน้าจอถาม
else {
  jn.classList.add('show');
  document.getElementById('jname').value = 'MOBILE';
  document.getElementById('jgo').onclick = () =>
    doJoin(document.getElementById('jroom').value.trim().toUpperCase(), document.getElementById('jname').value.trim() || 'P2');
}

socket.on('me', d => { ME = d.id; const m = document.getElementById('mroom'); if (m) m.textContent = d.room; });
socket.on('warn', t => toast(t));
socket.on('state', st => { S = st; render(); });
socket.on('shot:result', r => startAnim(r));

/* ================= ANIMATION ================= */
function startAnim(r) {
  anim = { paths: r.paths, blasts: r.blasts, i: 0, max: Math.max(...r.paths.map(p => p.length)) };
  craterFx = [];
  const tick = () => {
    if (!anim) return;
    anim.i += 3;
    if (anim.i >= anim.max) { craterFx = anim.blasts.map(b => ({ ...b, life: 22 })); anim = null; render(); fx(); return; }
    draw(); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function fx() {
  if (!craterFx.length) return;
  craterFx.forEach(c => c.life--);
  craterFx = craterFx.filter(c => c.life > 0);
  draw(); requestAnimationFrame(fx);
}

/* ================= CANVAS (ใช้ร่วมกัน 2 สกิน) ================= */
function draw() {
  const cv = STEALTH ? document.getElementById('cx') : document.getElementById('mc');
  if (!cv || !S || !S.shot) return;
  const g = cv.getContext('2d'), sx = cv.width / W, sy = cv.height / H;
  const s = S.shot;
  g.clearRect(0, 0, cv.width, cv.height);

  if (STEALTH) { // โหมดกราฟ Excel: ขาวเทา เส้นบาง
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#ededed'; g.lineWidth = 1;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, cv.height * i / 5); g.lineTo(cv.width, cv.height * i / 5); g.stroke(); }
  } else {
    const gr = g.createLinearGradient(0, 0, 0, cv.height);
    gr.addColorStop(0, '#1a2440'); gr.addColorStop(1, '#0b1020');
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  }

  // ภูมิประเทศ
  g.beginPath(); g.moveTo(0, cv.height);
  for (let x = 0; x <= W; x += 5) g.lineTo(x * sx, terrainY(x, s.seed, s.craters) * sy);
  g.lineTo(cv.width, cv.height); g.closePath();
  g.fillStyle = STEALTH ? '#f0f0f0' : '#2d4a34'; g.fill();
  g.strokeStyle = STEALTH ? '#b8b8b8' : '#4e7a58'; g.lineWidth = STEALTH ? 1 : 2; g.stroke();

  // ผู้เล่น
  (S.players || []).forEach((p, i) => {
    const pos = s.pos[p.id]; if (!pos) return;
    const x = pos.x * sx, y = pos.y * sy;
    g.fillStyle = STEALTH ? (i ? '#666' : '#999') : (i ? '#ef6a5a' : '#6ee7a8');
    g.fillRect(x - 8 * sx, y - 13 * sy, 16 * sx, 13 * sy);
    const hp = s.hp[p.id] || 0;
    g.fillStyle = STEALTH ? '#ddd' : '#333'; g.fillRect(x - 14 * sx, y - 24 * sy, 28 * sx, 4 * sy);
    g.fillStyle = STEALTH ? '#777' : (hp > 40 ? '#6ee7a8' : '#ef6a5a'); g.fillRect(x - 14 * sx, y - 24 * sy, 28 * sx * hp / 100, 4 * sy);
    if (!STEALTH) { g.fillStyle = '#cfd7e6'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText(p.name, x, y - 30 * sy); }
  });

  // เส้นวิถี
  if (anim) {
    g.lineWidth = STEALTH ? 1.2 : 2.5;
    g.strokeStyle = STEALTH ? '#8a8a8a' : BALLS[AIM.ball]?.col || '#fff';
    if (STEALTH) g.setLineDash([3, 3]);
    for (const p of anim.paths) {
      g.beginPath();
      const n = Math.min(anim.i, p.length);
      for (let i = 0; i < n; i++) g.lineTo(p[i].x * sx, p[i].y * sy);
      g.stroke();
      if (n > 0 && n < p.length) {
        g.setLineDash([]); g.beginPath();
        g.arc(p[n - 1].x * sx, p[n - 1].y * sy, STEALTH ? 2.5 : 6, 0, 7);
        g.fillStyle = STEALTH ? '#555' : '#fff'; g.fill();
        if (STEALTH) g.setLineDash([3, 3]);
      }
    }
    g.setLineDash([]);
  }
  for (const c of craterFx) {
    g.beginPath(); g.arc(c.x * sx, c.y * sy, c.r * sx * (1 + (22 - c.life) / 22), 0, 7);
    g.strokeStyle = STEALTH ? `rgba(120,120,120,${c.life / 22})` : `rgba(255,170,60,${c.life / 22})`;
    g.lineWidth = STEALTH ? 1 : 4; g.stroke();
  }
  // เส้นเล็งบนมือถือ
  if (!STEALTH && myTurnShot() && !anim) {
    const pos = s.pos[ME], i = S.players.findIndex(p => p.id === ME), dir = i === 0 ? 1 : -1;
    const rad = AIM.angle * Math.PI / 180;
    g.beginPath(); g.moveTo(pos.x * sx, (pos.y - 14) * sy);
    g.lineTo((pos.x + Math.cos(rad) * AIM.power * dir) * sx, (pos.y - 14 - Math.sin(rad) * AIM.power) * sy);
    g.strokeStyle = '#ffffff77'; g.lineWidth = 2; g.setLineDash([6, 6]); g.stroke(); g.setLineDash([]);
  }
}
const myTurnShot = () => S && S.mode === 'shot' && !S.shot.over && S.players[S.shot.turn]?.id === ME;
const myTurnUno = () => S && S.mode === 'uno' && !S.uno.over && S.players[S.uno.turn]?.id === ME;

/* ================= RENDER ================= */
function render() { STEALTH ? renderXL() : renderMob(); draw(); }

/* ---------- EXCEL GRID ---------- */
const COLS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R'];
const ROWS = 34;
const MODELS = ['DF20ARL','DF20ARS','DF20ATL','DF20ATS','DF20ATX','DF20ATHL','DT25KL','DT30RS','DF25ATL','DF25ATHL','DF30AL','DF30AS','DF30AQHEL','DF30ATL','DF30ATS','DF30ATHL','DF9.9BTL','DF9.9BTX'];
const grid = document.getElementById('grid');
let gridBuilt = false, selCell = null;

function buildGrid() {
  let h = '<tr><th style="width:34px"></th>' + COLS.map(c => `<th style="width:${c==='B'?110:c==='M'?200:c==='H'?90:62}px">${c}</th>`).join('') + '</tr>';
  for (let r = 1; r <= ROWS; r++) {
    h += `<tr><td class="rh">${r}</td>` + COLS.map(c => `<td data-c="${c}" data-r="${r}"></td>`).join('') + '</tr>';
  }
  grid.innerHTML = h;
  grid.onclick = e => {
    const td = e.target.closest('td[data-c]'); if (!td) return;
    if (selCell) selCell.classList.remove('sel');
    selCell = td; td.classList.add('sel');
    document.getElementById('namebox').value = td.dataset.c + td.dataset.r;
    document.getElementById('fx').value = td.textContent;
    if (td.dataset.act) handleCellAction(td.dataset.act);
  };
  gridBuilt = true;
}
const cell = (c, r) => grid.querySelector(`td[data-c="${c}"][data-r="${r}"]`);
function setCell(c, r, txt, cls, act) {
  const td = cell(c, r); if (!td) return;
  td.textContent = txt == null ? '' : txt;
  td.className = (td === selCell ? 'sel ' : '') + (cls || '');
  if (act) { td.dataset.act = act; td.classList.add('play'); } else delete td.dataset.act;
}
function handleCellAction(a) {
  const [k, v] = a.split(':');
  if (k === 'uno') playCard(+v);
  if (k === 'find') socket.emit('find:pick', +v);
  if (k === 'ball') { AIM.ball = v; render(); }
}

function renderXL() {
  if (!gridBuilt) buildGrid();
  for (let r = 1; r <= ROWS; r++) for (const c of COLS) setCell(c, r, '');

  setCell('A', 1, 'AUGUST 2026 : SA-EX-260096', 'hd');
  const head = { A: 'NO', B: 'MODEL', C: 'K', D: 'CODE', E: 'SEL', F: 'COL', G: 'QTY', H: 'CJD-NO.', I: 'INVOICE', J: 'STATUS', K: 'LOT', L: 'RESULT', M: 'REMARK' };
  for (const k in head) setCell(k, 3, head[k], 'hd');

  // ข้อมูลหลอกให้ดูเหมือนงานจริง
  for (let i = 0; i < 22; i++) {
    const r = 4 + i, m = MODELS[i % MODELS.length];
    setCell('A', r, i + 1); setCell('B', r, m); setCell('C', r, 27);
    setCell('D', r, 'E9' + (1 + i % 6)); setCell('E', r, ['LKE','SKE','LCE','XCE','LDE','SEE'][i % 6]);
    setCell('F', r, i % 3 ? 'YAY' : 'QTN'); setCell('G', r, (1 + i % 7) * 10);
    setCell('H', r, 'CJD-0' + (1 + i % 7) + '-6' + (200 + i * 7));
    setCell('I', r, 'DN-31' + (340 + i)); setCell('J', r, i % 4 ? 'NOTHING CHANGE' : 'SEND ALREADY', i % 4 ? '' : 'or');
  }
  setCell('B', 2, 'SEND ALREADY'); setCell('D', 2, 16, 'pk'); setCell('E', 2, 'ITEM', 'pk');

  const st2 = document.getElementById('stat2');
  if (!S) { st2.textContent = ''; return; }

  // สกอร์ซ่อนในสถานะ
  const sc = (S.players || []).map(p => (S.score[p.id] || 0)).join(' - ');
  st2.textContent = `Count: ${S.players.length}   Sum: ${sc}   Mode: ${S.mode.toUpperCase()}`;

  // --- เกมยิงหิน ---
  if (S.mode === 'shot') {
    setCell('L', 3, 'RESULT', 'hd');
    setCell('L', 4, `ANG ${AIM.angle}`); setCell('L', 5, `PWR ${AIM.power}`);
    setCell('L', 6, `TYP ${BALLS[AIM.ball].c}`); setCell('L', 7, `WIND ${S.shot.wind}`);
    setCell('L', 8, myTurnShot() ? 'READY' : 'WAIT', myTurnShot() ? 'gn' : 'dim');
    S.players.forEach((p, i) => setCell('L', 9 + i, `${p.name} ${S.shot.hp[p.id]}`, S.shot.hp[p.id] < 40 ? 'or' : ''));
    BK.forEach((k, i) => setCell('K', 4 + i, BALLS[k].c, AIM.ball === k ? 'hot' : 'dim', 'ball:' + k));
    if (S.shot.over) setCell('L', 12, S.shot.over === ME ? 'PASSED' : 'REJECTED', 'gn');
    document.getElementById('clegend').textContent = `Series1 ${S.players[0]?.name || '-'} · Series2 ${S.players[1]?.name || '-'} · Index ${S.shot.wind}`;
  }

  // --- UNO: ไพ่ = รหัสรุ่นในคอลัมน์ B ---
  if (S.mode === 'uno') {
    setCell('L', 3, 'RESULT', 'hd');
    const top = S.uno.top;
    setCell('L', 4, 'TOP ' + cardCode(top));
    setCell('L', 5, 'COL ' + CCODE[S.uno.color] + ' (' + CNAME[S.uno.color] + ')');
    setCell('L', 6, 'OPP ' + (S.uno.counts[S.players.findIndex(p => p.id !== ME)] || 0) + ' ITEM');
    setCell('L', 7, myTurnUno() ? 'YOUR TURN' : 'WAIT', myTurnUno() ? 'gn' : 'dim');
    setCell('L', 8, 'DECK ' + S.uno.deck);
    HAND.forEach((c, i) => {
      const r = 4 + i; if (r > ROWS) return;
      setCell('B', r, cardCode(c), myTurnUno() ? '' : 'dim', 'uno:' + c.id);
      setCell('D', r, CCODE[c.c]); setCell('G', r, isNaN(+c.v) ? c.v : +c.v);
      setCell('A', r, i + 1);
    });
    for (let r = 4 + HAND.length; r < 26; r++) { setCell('B', r, MODELS[r % MODELS.length], 'dim'); }
    if (S.uno.over) setCell('L', 10, S.uno.over === ME ? 'APPROVED' : 'REJECTED', 'gn');
  }

  // --- FIND: ตารางตัวเลขล้วน เนียนที่สุด ---
  if (S.mode === 'find') {
    setCell('L', 3, 'RESULT', 'hd');
    setCell('L', 4, 'TARGET ' + S.find.target, 'hot');
    setCell('L', 5, 'ROUND ' + S.find.round + '/7');
    S.players.forEach((p, i) => setCell('L', 6 + i, p.name + ' ' + (S.find.pts[p.id] || 0)));
    S.find.nums.forEach((n, i) => {
      const c = COLS[1 + (i % 6)], r = 4 + Math.floor(i / 6);
      setCell(c, r, n, '', 'find:' + n);
    });
  }

  // --- แชทในคอลัมน์ REMARK ---
  const ch = S.chat.slice(-20);
  setCell('M', 3, 'REMARK', 'hd');
  ch.forEach((m, i) => setCell('M', 4 + i, `${m.who}: ${m.text}`, 'dim'));
}

/* ---------- MOBILE ---------- */
function renderMob() {
  if (!S) return;
  document.getElementById('mscore').textContent = (S.players || []).map(p => S.score[p.id] || 0).join(' - ');
  // shot
  if (S.shot) {
    document.getElementById('hw').textContent = 'ลม ' + S.shot.wind;
    document.getElementById('ht').textContent = S.shot.over ? (S.shot.over === ME ? 'คุณชนะ 🎉' : 'แพ้แล้ว') : (myTurnShot() ? 'ตาคุณ' : 'รออีกฝ่าย');
  }
  const bb = document.getElementById('balls');
  if (bb.children.length !== BK.length) {
    bb.innerHTML = BK.map(k => `<button data-b="${k}">${BALLS[k].n}</button>`).join('');
    bb.onclick = e => { const b = e.target.dataset.b; if (b) { AIM.ball = b; renderMob(); draw(); } };
  }
  [...bb.children].forEach(b => b.classList.toggle('on', b.dataset.b === AIM.ball));
  // uno
  if (S.uno) {
    const t = S.uno.top;
    const ut = document.getElementById('utop');
    ut.className = 'card big ' + t.c; ut.textContent = t.v;
    document.getElementById('ucolor').textContent = CNAME[S.uno.color];
    document.getElementById('uopp').textContent = S.uno.counts[S.players.findIndex(p => p.id !== ME)] || 0;
    document.getElementById('uturn').textContent = S.uno.over ? (S.uno.over === ME ? 'คุณชนะ 🎉' : 'อีกฝ่ายชนะ') : (myTurnUno() ? 'ตาคุณ' : 'รออีกฝ่าย');
    const h = document.getElementById('uhand');
    h.innerHTML = HAND.map(c => `<div class="card ${c.c}" data-id="${c.id}">${c.v}</div>`).join('');
    h.onclick = e => { const d = e.target.closest('[data-id]'); if (d) playCard(+d.dataset.id); };
  }
  // find
  if (S.find) {
    document.getElementById('ftar').textContent = S.find.target;
    document.getElementById('fround').textContent = `(${S.find.round}/7) ` + S.players.map(p => `${p.name} ${S.find.pts[p.id] || 0}`).join(' · ');
    const fg = document.getElementById('fgrid');
    fg.innerHTML = S.find.nums.map(n => `<div data-n="${n}">${n}</div>`).join('');
    fg.onclick = e => { const n = e.target.dataset.n; if (n) socket.emit('find:pick', +n); };
  }
  // chat
  const cb = document.getElementById('mchat');
  cb.innerHTML = S.chat.map(m => `<p><b>${m.who}</b> ${m.text}</p>`).join('');
  cb.scrollTop = cb.scrollHeight;
}
socket.on('hand', h => { HAND = h; render(); });

function playCard(id) {
  const c = HAND.find(x => x.id === id); if (!c) return;
  let col = null;
  if (c.c === 'W') {
    col = STEALTH ? (prompt('เลือกสี R/G/B/Y', 'R') || 'R').toUpperCase().trim()
                  : (prompt('เลือกสี: R=แดง G=เขียว B=น้ำเงิน Y=เหลือง', 'R') || 'R').toUpperCase().trim();
  }
  socket.emit('uno:play', { id, color: col });
}

/* ================= INPUT: มือถือ ================= */
if (!STEALTH) {
  const sa = document.getElementById('sa'), sp = document.getElementById('sp');
  const sync = () => {
    AIM.angle = +sa.value; AIM.power = +sp.value;
    document.getElementById('ha').textContent = AIM.angle;
    document.getElementById('hp').textContent = AIM.power;
    draw();
  };
  sa.oninput = sp.oninput = sync; sync();
  document.getElementById('fire').onclick = () => socket.emit('fire', AIM);
  document.getElementById('newshot').onclick = () => socket.emit('start', 'shot');
  document.getElementById('unew').onclick = () => socket.emit('start', 'uno');
  document.getElementById('fnew').onclick = () => socket.emit('start', 'find');
  document.getElementById('udraw').onclick = () => socket.emit('uno:draw');
  document.getElementById('msend').onclick = sendChat;
  document.getElementById('mchatin').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
  function sendChat() {
    const i = document.getElementById('mchatin');
    if (i.value.trim()) socket.emit('chat', i.value.trim());
    i.value = '';
  }
  document.getElementById('mtabs').onclick = e => {
    const g = e.target.dataset.g; if (!g) return;
    [...document.querySelectorAll('#mtabs button')].forEach(b => b.classList.toggle('on', b.dataset.g === g));
    [...document.querySelectorAll('.pane')].forEach(p => p.classList.toggle('on', p.id === 'p-' + g));
    if (g !== 'chat' && S && S.mode !== g && ['shot', 'uno', 'find'].includes(g) && S.players.length === 2) socket.emit('start', g);
    render();
  };
  // ลากบน canvas เพื่อเล็ง
  const mc = document.getElementById('mc');
  let dragging = false;
  mc.addEventListener('pointerdown', () => dragging = true);
  mc.addEventListener('pointerup', () => dragging = false);
  mc.addEventListener('pointermove', e => {
    if (!dragging || !myTurnShot()) return;
    const r = mc.getBoundingClientRect();
    const pos = S.shot.pos[ME], i = S.players.findIndex(p => p.id === ME), dir = i === 0 ? 1 : -1;
    const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    const dx = (x - pos.x) * dir, dy = pos.y - y;
    AIM.angle = Math.max(1, Math.min(89, Math.round(Math.atan2(dy, Math.max(1, dx)) * 180 / Math.PI)));
    AIM.power = Math.max(5, Math.min(100, Math.round(Math.hypot(dx, dy) * 0.6)));
    sa.value = AIM.angle; sp.value = AIM.power; sync();
  });
}

/* ================= INPUT: คอม (คำสั่ง + คีย์ลัด) ================= */
function toast(t) {
  if (!STEALTH) { alert(t); return; }
  const st = document.getElementById('stat2'); const old = st.textContent;
  st.textContent = t; setTimeout(() => st.textContent = old, 2500);
}
if (STEALTH) {
  const fx = document.getElementById('fx');
  const HELPTXT = '/shot /uno /find | /a45 /p70 /b2 /f | /d จั่ว | /c R | /h ช่วยเหลือ | ข้อความอื่น = แชท';
  fx.placeholder = '';
  fx.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const v = fx.value.trim(); fx.value = '';
    if (!v) return;
    const low = v.toLowerCase();
    if (low === '/h') return toast(HELPTXT);
    if (low === '/shot') return socket.emit('start', 'shot');
    if (low === '/uno') return socket.emit('start', 'uno');
    if (low === '/find') return socket.emit('start', 'find');
    if (low === '/d') return socket.emit('uno:draw');
    if (low === '/f') return socket.emit('fire', AIM);
    let m;
    if ((m = low.match(/^\/a\s*(\d+)$/))) { AIM.angle = +m[1]; return render(); }
    if ((m = low.match(/^\/p\s*(\d+)$/))) { AIM.power = +m[1]; return render(); }
    if ((m = low.match(/^\/b\s*(\d)$/))) { AIM.ball = BK[+m[1] - 1] || 'STD'; return render(); }
    if ((m = low.match(/^\/u\s*(\d+)$/))) { const c = HAND[+m[1] - 1]; if (c) playCard(c.id); return; }
    socket.emit('chat', v);
  };
  addEventListener('keydown', e => {
    if (document.activeElement === fx || document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Escape') { fx.blur(); document.body.classList.add('boss'); }
      return;
    }
    if (e.key === 'Escape') { document.body.classList.toggle('boss'); return; }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'g') { document.body.classList.remove('boss'); fx.focus(); return; }
    if (!S) return;
    if (e.key === 'ArrowLeft') { AIM.angle = Math.max(1, AIM.angle - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { AIM.angle = Math.min(89, AIM.angle + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { AIM.power = Math.min(100, AIM.power + 2); render(); e.preventDefault(); }
    if (e.key === 'ArrowDown') { AIM.power = Math.max(5, AIM.power - 2); render(); e.preventDefault(); }
    if (e.key === ' ') { socket.emit('fire', AIM); e.preventDefault(); }
    if (e.key === 'Tab') { AIM.ball = BK[(BK.indexOf(AIM.ball) + 1) % BK.length]; render(); e.preventDefault(); }
  });
  addEventListener('blur', () => document.body.classList.add('boss'));   // สลับหน้าต่าง = ซ่อนทันที
  addEventListener('focus', () => { });
  document.getElementById('namebox').onkeydown = e => {
    if (e.key === 'Enter') { doJoin(e.target.value.trim().toUpperCase(), localStorage.olName || 'PC'); location.reload(); }
  };
  render();
}
