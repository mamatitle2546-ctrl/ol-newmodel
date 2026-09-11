/* ================= SETUP ================= */
const socket = io();
const qs = new URLSearchParams(location.search);
const coarse = matchMedia('(pointer:coarse)').matches;
const STEALTH = qs.get('ui') === 'stealth' ? true : qs.get('ui') === 'full' ? false : !(coarse && innerWidth < 1000);
document.body.classList.add(STEALTH ? 'stealth' : 'full');

const W = 1000, H = 520;
let ME = null, ROOM = '', PIN = '', S = null, HAND = [], AIM = { angle: 45, power: 60, ball: 'STD' };
let anim = null, craterFx = [], pendingWild = null;

const BALLS = {
  STD:   { n:'หินธรรมดา',  c:'DF20ARL', col:'#cbd5e1' },
  HEAVY: { n:'หินก้อนใหญ่', c:'DF30ATL', col:'#94a3b8' },
  SPLIT: { n:'หินแตกสาม',  c:'DF25ATL', col:'#fbbf24' },
  DRILL: { n:'หินเจาะ',    c:'DT30RS',  col:'#60a5fa' }
};
const BK = Object.keys(BALLS);
const CCODE = { R:'E91', G:'E92', B:'E93', Y:'E96', W:'E95' };
const CNAME = { R:'แดง', G:'เขียว', B:'น้ำเงิน', Y:'เหลือง', W:'ไวลด์' };
const VMAP = { S:'SKE', R:'RVS', D2:'PLS', W:'WLD', W4:'WL4' };

function terrainY(x, seed, craters) {
  const a = seed * 6.283, b = seed * 11.7, c = seed * 3.1;
  let y = 380 + 45 * Math.sin(x * 0.0065 + a) + 26 * Math.sin(x * 0.019 + b) + 11 * Math.sin(x * 0.043 + c);
  if (craters) for (const cr of craters) { const d = Math.abs(x - cr.x); if (d < cr.r) y += Math.sqrt(cr.r * cr.r - d * d) * 0.55; }
  return Math.max(120, Math.min(H - 4, y));
}
const cardCode = c => c.c === 'W'
  ? `${VMAP[c.v]}-${c.v === 'W4' ? '04' : '00'}AL`
  : `DF${(isNaN(+c.v) ? VMAP[c.v] : String(c.v).padStart(2, '0'))}A${c.c}L`;

/* ================= QR (byte mode, ECC-L, ver 1-5) ================= */
const QR = (() => {
  const EXP = [], LOG = [];
  (() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const mul = (a, b) => (!a || !b) ? 0 : EXP[LOG[a] + LOG[b]];
  const SPEC = { 1:[26,7], 2:[44,10], 3:[70,15], 4:[100,20], 5:[134,26] };
  const ALIGN = { 1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30] };
  const MASKS = [
    (r,c)=>(r+c)%2===0, (r,c)=>r%2===0, (r,c)=>c%3===0, (r,c)=>(r+c)%3===0,
    (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0, (r,c)=>((r*c)%2+(r*c)%3)===0,
    (r,c)=>(((r*c)%2+(r*c)%3)%2)===0, (r,c)=>(((r+c)%2+(r*c)%3)%2)===0
  ];
  const gpoly = n => { let g = [1]; for (let i = 0; i < n; i++) { const t = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { t[j] ^= g[j]; t[j+1] ^= mul(g[j], EXP[i]); } g = t; } return g; };
  const ecc = (d, n) => { const g = gpoly(n), r = d.concat(new Array(n).fill(0)); for (let i = 0; i < d.length; i++) { const c = r[i]; if (!c) continue; for (let j = 0; j < g.length; j++) r[i+j] ^= mul(g[j], c); } return r.slice(d.length); };
  const fmtbits = m => { const d = (1 << 3) | m; let v = d << 10; for (let i = 4; i >= 0; i--) if (v & (1 << (i+10))) v ^= 0x537 << i; return ((d << 10) | v) ^ 0x5412; };
  function penalty(g) {
    const n = g.length; let p = 0;
    for (let r = 0; r < n; r++) for (let k = 0; k < 2; k++) {
      let run = 1, prev = k ? g[0][r] : g[r][0];
      for (let i = 1; i < n; i++) { const v = k ? g[i][r] : g[r][i]; if (v === prev) { run++; } else { if (run >= 5) p += 3 + run - 5; run = 1; prev = v; } }
      if (run >= 5) p += 3 + run - 5;
    }
    for (let r = 0; r < n-1; r++) for (let c = 0; c < n-1; c++) { const v = g[r][c]; if (v === g[r][c+1] && v === g[r+1][c] && v === g[r+1][c+1]) p += 3; }
    return p;
  }
  function make(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); bytes.push(c < 128 ? c : 63); }
    let ver = 1;
    while (ver < 5 && bytes.length > SPEC[ver][0] - SPEC[ver][1] - 2) ver++;
    const dataLen = SPEC[ver][0] - SPEC[ver][1], bits = [];
    const put = (v, n) => { for (let i = n-1; i >= 0; i--) bits.push((v >> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach(b => put(b, 8));
    for (let i = 0; i < 4 && bits.length < dataLen*8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const dw = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i+j]; dw.push(b); }
    const pads = [0xEC, 0x11]; let pi = 0;
    while (dw.length < dataLen) dw.push(pads[pi++ % 2]);
    const all = dw.concat(ecc(dw, SPEC[ver][1]));
    const dbits = []; all.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >> i) & 1); });

    const size = 17 + ver * 4;
    const base = Array.from({ length: size }, () => new Array(size).fill(null));
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
      const rr = r+i, cc = c+j; if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
      base[rr][cc] = ((i>=0&&i<=6&&(j===0||j===6))||(j>=0&&j<=6&&(i===0||i===6))||(i>=2&&i<=4&&j>=2&&j<=4)) ? 1 : 0;
    }};
    finder(0,0); finder(0,size-7); finder(size-7,0);
    for (let i = 8; i < size-8; i++) { base[6][i] = i%2===0?1:0; base[i][6] = i%2===0?1:0; }
    const al = ALIGN[ver];
    for (const r of al) for (const c of al) {
      if ((r<9&&c<9)||(r<9&&c>size-10)||(r>size-10&&c<9)) continue;
      for (let i=-2;i<=2;i++) for (let j=-2;j<=2;j++) base[r+i][c+j] = Math.max(Math.abs(i),Math.abs(j))!==1 ? 1 : 0;
    }
    base[size-8][8] = 1;
    for (let i = 0; i < 9; i++) { if (base[8][i] === null) base[8][i] = 0; if (base[i][8] === null) base[i][8] = 0; }
    for (let i = 0; i < 8; i++) { if (base[8][size-1-i] === null) base[8][size-1-i] = 0; if (base[size-1-i][8] === null) base[size-1-i][8] = 0; }
    const reserved = base.map(r => r.map(v => v !== null));

    function render(mask) {
      const g = base.map(r => r.slice());
      let bi = 0, dir = -1, row = size-1, col = size-1;
      while (col > 0) {
        if (col === 6) col--;
        for (;;) {
          for (let z = 0; z < 2; z++) {
            const c = col - z;
            if (!reserved[row][c]) { let v = bi < dbits.length ? dbits[bi++] : 0; if (MASKS[mask](row, c)) v ^= 1; g[row][c] = v; }
          }
          row += dir;
          if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
        }
        col -= 2;
      }
      const f = fmtbits(mask);
      for (let i = 0; i < 15; i++) {
        const b = (f >> i) & 1;
        if (i < 6) g[8][i] = b; else if (i === 6) g[8][7] = b; else if (i === 7) g[8][8] = b;
        else if (i === 8) g[7][8] = b; else g[14-i][8] = b;
        if (i < 8) g[size-1-i][8] = b; else g[8][size-15+i] = b;
      }
      return g;
    }
    let best = null, bp = Infinity;
    for (let m = 0; m < 8; m++) { const g = render(m), p = penalty(g); if (p < bp) { bp = p; best = g; } }
    return best;
  }
  return { make };
})();

function drawQR(cv, text) {
  const m = QR.make(text), n = m.length, q = 3, g = cv.getContext('2d');
  const s = Math.floor(cv.width / (n + q*2));
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) g.fillRect((c+q)*s, (r+q)*s, s, s);
}

/* ================= JOIN ================= */
const jn = document.getElementById('join');
const DEFAULT_ROOM = 'SA-EX-260096';
let CID = localStorage.olCid || (localStorage.olCid = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
const urlRoom = (qs.get('r') || qs.get('room') || '').toUpperCase().trim();
const urlPin = (qs.get('k') || qs.get('pin') || '').trim();

function doJoin(roomId, name, pin) {
  ROOM = (roomId || DEFAULT_ROOM).toUpperCase().trim();
  PIN = (pin || '').trim();
  localStorage.olRoom = ROOM; localStorage.olName = name; localStorage.olPin = PIN;
  socket.emit('join', { roomId: ROOM, name, cid: CID, pin: PIN });
  jn.classList.remove('show');
}
function shareLink() { return location.origin + location.pathname + '?r=' + encodeURIComponent(ROOM) + (PIN ? '&k=' + encodeURIComponent(PIN) : ''); }

if (urlRoom) doJoin(urlRoom, localStorage.olName || (STEALTH ? 'PC' : 'MOBILE'), urlPin || localStorage.olPin || '');
else if (localStorage.olRoom && localStorage.olName) doJoin(localStorage.olRoom, localStorage.olName, localStorage.olPin || '');
else if (STEALTH) doJoin(DEFAULT_ROOM, 'PC', '');
else {
  jn.classList.add('show');
  document.getElementById('jgo').onclick = () => doJoin(
    document.getElementById('jroom').value,
    document.getElementById('jname').value.trim() || 'P2',
    document.getElementById('jpin').value
  );
}

socket.on('me', d => {
  ME = d.cid; ROOM = d.room;
  const m = document.getElementById('mroom'); if (m) m.textContent = d.room;
  const lk = document.getElementById('mlock'); if (lk) lk.textContent = d.locked ? '🔒' : '';
  if (STEALTH) refreshQR();
});
socket.on('denied', msg => {
  if (STEALTH) { toast('LINK ERROR: ' + msg + '  (ใช้ /pin 1234 เพื่อลองใหม่)'); return; }
  const e = document.getElementById('jerr'); e.textContent = msg; e.classList.add('show');
  jn.classList.add('show');
  document.getElementById('jroom').value = ROOM || DEFAULT_ROOM;
  document.getElementById('jgo').onclick = () => doJoin(
    document.getElementById('jroom').value,
    document.getElementById('jname').value.trim() || 'P2',
    document.getElementById('jpin').value
  );
});
socket.on('warn', t => toast(t));
socket.on('state', st => { S = st; render(); });
socket.on('hand', h => { HAND = h; render(); });
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

/* ================= CANVAS ================= */
const myTurnShot = () => S && S.mode === 'shot' && S.shot && !S.shot.over && S.players[S.shot.turn]?.cid === ME;
const myTurnUno  = () => S && S.mode === 'uno'  && S.uno  && !S.uno.over  && S.players[S.uno.turn]?.cid === ME;

function draw() {
  const cv = STEALTH ? document.getElementById('cx') : document.getElementById('mc');
  if (!cv || !S || !S.shot) return;
  const g = cv.getContext('2d'), sx = cv.width / W, sy = cv.height / H, s = S.shot;
  g.clearRect(0, 0, cv.width, cv.height);
  if (STEALTH) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#ededed'; g.lineWidth = 1;
    for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, cv.height*i/5); g.lineTo(cv.width, cv.height*i/5); g.stroke(); }
  } else {
    const gr = g.createLinearGradient(0, 0, 0, cv.height);
    gr.addColorStop(0, '#1a2440'); gr.addColorStop(1, '#0b1020');
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  }
  g.beginPath(); g.moveTo(0, cv.height);
  for (let x = 0; x <= W; x += 5) g.lineTo(x*sx, terrainY(x, s.seed, s.craters)*sy);
  g.lineTo(cv.width, cv.height); g.closePath();
  g.fillStyle = STEALTH ? '#f0f0f0' : '#2d4a34'; g.fill();
  g.strokeStyle = STEALTH ? '#b8b8b8' : '#4e7a58'; g.lineWidth = STEALTH ? 1 : 2; g.stroke();

  (S.players || []).forEach((p, i) => {
    const pos = s.pos[p.cid]; if (!pos) return;
    const x = pos.x*sx, y = pos.y*sy, hp = s.hp[p.cid] || 0;
    g.fillStyle = STEALTH ? (i ? '#666' : '#999') : (i ? '#ef6a5a' : '#6ee7a8');
    g.fillRect(x - 8*sx, y - 13*sy, 16*sx, 13*sy);
    g.fillStyle = STEALTH ? '#ddd' : '#333'; g.fillRect(x - 14*sx, y - 24*sy, 28*sx, 4*sy);
    g.fillStyle = STEALTH ? '#777' : (hp > 40 ? '#6ee7a8' : '#ef6a5a'); g.fillRect(x - 14*sx, y - 24*sy, 28*sx*hp/100, 4*sy);
    if (!STEALTH) { g.fillStyle = '#cfd7e6'; g.font = '13px sans-serif'; g.textAlign = 'center'; g.fillText(p.name, x, y - 30*sy); }
  });

  if (anim) {
    g.lineWidth = STEALTH ? 1.2 : 2.5;
    g.strokeStyle = STEALTH ? '#8a8a8a' : (BALLS[AIM.ball]?.col || '#fff');
    if (STEALTH) g.setLineDash([3, 3]);
    for (const p of anim.paths) {
      g.beginPath();
      const n = Math.min(anim.i, p.length);
      for (let i = 0; i < n; i++) g.lineTo(p[i].x*sx, p[i].y*sy);
      g.stroke();
      if (n > 0 && n < p.length) {
        g.setLineDash([]); g.beginPath();
        g.arc(p[n-1].x*sx, p[n-1].y*sy, STEALTH ? 2.5 : 6, 0, 7);
        g.fillStyle = STEALTH ? '#555' : '#fff'; g.fill();
        if (STEALTH) g.setLineDash([3, 3]);
      }
    }
    g.setLineDash([]);
  }
  for (const c of craterFx) {
    g.beginPath(); g.arc(c.x*sx, c.y*sy, c.r*sx*(1 + (22-c.life)/22), 0, 7);
    g.strokeStyle = STEALTH ? `rgba(120,120,120,${c.life/22})` : `rgba(255,170,60,${c.life/22})`;
    g.lineWidth = STEALTH ? 1 : 4; g.stroke();
  }
  if (!STEALTH && myTurnShot() && !anim) {
    const pos = s.pos[ME]; if (!pos) return;
    const i = S.players.findIndex(p => p.cid === ME), dir = i === 0 ? 1 : -1, rad = AIM.angle*Math.PI/180;
    g.beginPath(); g.moveTo(pos.x*sx, (pos.y-14)*sy);
    g.lineTo((pos.x + Math.cos(rad)*AIM.power*dir)*sx, (pos.y - 14 - Math.sin(rad)*AIM.power)*sy);
    g.strokeStyle = '#ffffff77'; g.lineWidth = 2; g.setLineDash([6,6]); g.stroke(); g.setLineDash([]);
  }
}

/* ================= RENDER ================= */
function render() { STEALTH ? renderXL() : renderMob(); draw(); }

const COLS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R'];
const ROWS = 34;
const MODELS = ['DF20ARL','DF20ARS','DF20ATL','DF20ATS','DF20ATX','DF20ATHL','DT25KL','DT30RS','DF25ATL','DF25ATHL','DF30AL','DF30AS','DF30AQHEL','DF30ATL','DF30ATS','DF30ATHL','DF9.9BTL','DF9.9BTX'];
const grid = document.getElementById('grid');
let gridBuilt = false, selCell = null;

function buildGrid() {
  let h = '<tr><th style="width:34px"></th>' + COLS.map(c => `<th style="width:${c==='B'?110:c==='M'?200:c==='H'?90:62}px">${c}</th>`).join('') + '</tr>';
  for (let r = 1; r <= ROWS; r++) h += `<tr><td class="rh">${r}</td>` + COLS.map(c => `<td data-c="${c}" data-r="${r}"></td>`).join('') + '</tr>';
  grid.innerHTML = h;
  grid.onclick = e => {
    const td = e.target.closest('td[data-c]'); if (!td) return;
    if (selCell) selCell.classList.remove('sel');
    selCell = td; td.classList.add('sel');
    document.getElementById('namebox').value = td.dataset.c + td.dataset.r;
    document.getElementById('fx').value = td.textContent;
    if (td.dataset.act) cellAction(td.dataset.act);
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
function cellAction(a) {
  const [k, v] = a.split(':');
  if (k === 'uno') playCard(+v);
  if (k === 'find') socket.emit('find:pick', +v);
  if (k === 'ball') { AIM.ball = v; render(); }
}

function renderXL() {
  if (!gridBuilt) buildGrid();
  for (let r = 1; r <= ROWS; r++) for (const c of COLS) setCell(c, r, '');
  setCell('A', 1, 'AUGUST 2026 : ' + (ROOM || DEFAULT_ROOM), 'hd');
  const head = { A:'NO', B:'MODEL', C:'K', D:'CODE', E:'SEL', F:'COL', G:'QTY', H:'CJD-NO.', I:'INVOICE', J:'STATUS', K:'LOT', L:'RESULT', M:'REMARK' };
  for (const k in head) setCell(k, 3, head[k], 'hd');
  for (let i = 0; i < 22; i++) {
    const r = 4 + i, m = MODELS[i % MODELS.length];
    setCell('A', r, i+1); setCell('B', r, m); setCell('C', r, 27);
    setCell('D', r, 'E9' + (1 + i%6)); setCell('E', r, ['LKE','SKE','LCE','XCE','LDE','SEE'][i%6]);
    setCell('F', r, i%3 ? 'YAY' : 'QTN'); setCell('G', r, (1 + i%7)*10);
    setCell('H', r, 'CJD-0' + (1 + i%7) + '-6' + (200 + i*7));
    setCell('I', r, 'DN-31' + (340 + i));
    setCell('J', r, i%4 ? 'NOTHING CHANGE' : 'SEND ALREADY', i%4 ? '' : 'or');
  }
  setCell('B', 2, 'SEND ALREADY'); setCell('D', 2, 16, 'pk'); setCell('E', 2, 'ITEM', 'pk');

  const st2 = document.getElementById('stat2');
  if (!S) { st2.textContent = ''; return; }
  const sc = (S.players || []).map(p => S.score[p.cid] || 0).join(' - ');
  const linked = S.players.length >= 2 ? (S.players.every(p => p.online) ? 'Shared ✔' : 'Reconnecting…') : 'Waiting for link…';
  st2.textContent = `${linked}   Count: ${S.players.length}   Sum: ${sc}   Mode: ${S.mode.toUpperCase()}`;

  if (S.mode === 'shot' && S.shot) {
    setCell('L', 4, `ANG ${AIM.angle}`); setCell('L', 5, `PWR ${AIM.power}`);
    setCell('L', 6, `TYP ${BALLS[AIM.ball].c}`); setCell('L', 7, `WIND ${S.shot.wind}`);
    setCell('L', 8, myTurnShot() ? 'READY' : 'WAIT', myTurnShot() ? 'gn' : 'dim');
    S.players.forEach((p, i) => setCell('L', 9+i, `${p.name} ${S.shot.hp[p.cid]}`, S.shot.hp[p.cid] < 40 ? 'or' : ''));
    BK.forEach((k, i) => setCell('K', 4+i, BALLS[k].c, AIM.ball === k ? 'hot' : 'dim', 'ball:' + k));
    if (S.shot.over) setCell('L', 12, S.shot.over === ME ? 'PASSED' : 'REJECTED', 'gn');
    document.getElementById('clegend').textContent = `Series1 ${S.players[0]?.name || '-'} · Series2 ${S.players[1]?.name || '-'} · Index ${S.shot.wind}`;
  }

  if (S.mode === 'uno' && S.uno) {
    const top = S.uno.top;
    setCell('L', 4, 'TOP ' + cardCode(top));
    setCell('L', 5, 'COL ' + CCODE[S.uno.color] + ' (' + CNAME[S.uno.color] + ')');
    const oi = S.players.findIndex(p => p.cid !== ME);
    setCell('L', 6, 'OPP ' + (S.uno.counts[oi] || 0) + ' ITEM');
    setCell('L', 7, myTurnUno() ? 'YOUR TURN' : 'WAIT', myTurnUno() ? 'gn' : 'dim');
    setCell('L', 8, 'DECK ' + S.uno.deck);
    if (pendingWild != null) setCell('L', 9, 'SELECT COLOR /c R|G|B|Y', 'hot');
    HAND.forEach((c, i) => {
      const r = 4 + i; if (r > ROWS) return;
      setCell('A', r, i+1);
      setCell('B', r, cardCode(c), myTurnUno() ? '' : 'dim', 'uno:' + c.id);
      setCell('D', r, CCODE[c.c]); setCell('G', r, isNaN(+c.v) ? c.v : +c.v);
    });
    for (let r = 4 + HAND.length; r < 26; r++) setCell('B', r, MODELS[r % MODELS.length], 'dim');
    if (S.uno.over) setCell('L', 10, S.uno.over === ME ? 'APPROVED' : 'REJECTED', 'gn');
  }

  if (S.mode === 'find' && S.find) {
    setCell('L', 4, 'TARGET ' + S.find.target, 'hot');
    setCell('L', 5, 'ROUND ' + S.find.round + '/7');
    S.players.forEach((p, i) => setCell('L', 6+i, p.name + ' ' + (S.find.pts[p.cid] || 0)));
    S.find.nums.forEach((n, i) => setCell(COLS[1 + (i % 6)], 4 + Math.floor(i/6), n, '', 'find:' + n));
  }

  setCell('M', 3, 'REMARK', 'hd');
  S.chat.slice(-20).forEach((m, i) => setCell('M', 4+i, `${m.who}: ${m.text}`, 'dim'));
}

function renderMob() {
  if (!S) return;
  document.getElementById('mscore').textContent = (S.players || []).map(p => S.score[p.cid] || 0).join(' - ');
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

  if (S.uno) {
    const t = S.uno.top, ut = document.getElementById('utop');
    ut.className = 'card big ' + t.c; ut.textContent = t.v;
    document.getElementById('ucolor').textContent = CNAME[S.uno.color];
    const oi = S.players.findIndex(p => p.cid !== ME);
    document.getElementById('uopp').textContent = S.uno.counts[oi] || 0;
    document.getElementById('uturn').textContent = S.uno.over ? (S.uno.over === ME ? 'คุณชนะ 🎉' : 'อีกฝ่ายชนะ') : (myTurnUno() ? 'ตาคุณ' : 'รออีกฝ่าย');
    const h = document.getElementById('uhand');
    h.innerHTML = HAND.map(c => `<div class="card ${c.c}" data-id="${c.id}">${c.v}</div>`).join('');
    h.onclick = e => { const d = e.target.closest('[data-id]'); if (d) playCard(+d.dataset.id); };
    document.getElementById('wildpick').classList.toggle('show', pendingWild != null);
  }
  if (S.find) {
    document.getElementById('ftar').textContent = S.find.target;
    document.getElementById('fround').textContent = `(${S.find.round}/7) ` + S.players.map(p => `${p.name} ${S.find.pts[p.cid] || 0}`).join(' · ');
    const fg = document.getElementById('fgrid');
    fg.innerHTML = S.find.nums.map(n => `<div data-n="${n}">${n}</div>`).join('');
    fg.onclick = e => { const n = e.target.dataset.n; if (n) socket.emit('find:pick', +n); };
  }
  const cb = document.getElementById('mchat');
  cb.innerHTML = S.chat.map(m => `<p><b>${m.who}</b> ${m.text}</p>`).join('');
  cb.scrollTop = cb.scrollHeight;
}

function playCard(id) {
  const c = HAND.find(x => x.id === id); if (!c) return;
  if (c.c === 'W') { pendingWild = id; render(); toast('เลือกสีด้วย /c R | G | B | Y'); return; }
  socket.emit('uno:play', { id, color: null });
}

/* ================= MOBILE INPUT ================= */
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
  document.getElementById('wildpick').onclick = e => {
    const w = e.target.dataset.w; if (!w || pendingWild == null) return;
    socket.emit('uno:play', { id: pendingWild, color: w }); pendingWild = null; render();
  };
  document.getElementById('mshare').onclick = async () => {
    const url = shareLink();
    try {
      if (navigator.share) await navigator.share({ title: 'OL_Newmodel', url });
      else { await navigator.clipboard.writeText(url); alert('คัดลอกลิงก์แล้ว:\n' + url); }
    } catch (_) { prompt('ลิงก์ห้อง', url); }
  };
  const sendChat = () => {
    const i = document.getElementById('mchatin');
    if (i.value.trim()) socket.emit('chat', i.value.trim());
    i.value = '';
  };
  document.getElementById('msend').onclick = sendChat;
  document.getElementById('mchatin').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
  document.getElementById('mtabs').onclick = e => {
    const g = e.target.dataset.g; if (!g) return;
    [...document.querySelectorAll('#mtabs button')].forEach(b => b.classList.toggle('on', b.dataset.g === g));
    [...document.querySelectorAll('.pane')].forEach(p => p.classList.toggle('on', p.id === 'p-' + g));
    if (['shot','uno','find'].includes(g) && S && S.mode !== g && S.players.length === 2) socket.emit('start', g);
    render();
  };
  const mc = document.getElementById('mc');
  let dragging = false;
  mc.addEventListener('pointerdown', () => dragging = true);
  mc.addEventListener('pointerup', () => dragging = false);
  mc.addEventListener('pointercancel', () => dragging = false);
  mc.addEventListener('pointermove', e => {
    if (!dragging || !myTurnShot()) return;
    const rc = mc.getBoundingClientRect(), pos = S.shot.pos[ME]; if (!pos) return;
    const i = S.players.findIndex(p => p.cid === ME), dir = i === 0 ? 1 : -1;
    const x = (e.clientX - rc.left)/rc.width*W, y = (e.clientY - rc.top)/rc.height*H;
    const dx = (x - pos.x)*dir, dy = pos.y - y;
    AIM.angle = Math.max(1, Math.min(89, Math.round(Math.atan2(dy, Math.max(1, dx))*180/Math.PI)));
    AIM.power = Math.max(5, Math.min(100, Math.round(Math.hypot(dx, dy)*0.6)));
    sa.value = AIM.angle; sp.value = AIM.power; sync();
  });
}

/* ================= PC (STEALTH) INPUT ================= */
function toast(t) {
  if (!STEALTH) { const e = document.getElementById('mchat'); if (e) { S && S.chat && null; } alert(t); return; }
  const st = document.getElementById('stat2'), old = st.textContent;
  st.textContent = t; setTimeout(() => { if (st.textContent === t) st.textContent = old; }, 4000);
}
let qrTimer = null;
function refreshQR() {
  const cv = document.getElementById('qr'); if (!cv) return;
  try { drawQR(cv, shareLink()); } catch (e) { }
}
function toggleQR(force) {
  const w = document.getElementById('qrwrap'); if (!w) return;
  const on = force !== undefined ? force : !w.classList.contains('show');
  if (on) { refreshQR(); w.classList.add('show'); clearTimeout(qrTimer); qrTimer = setTimeout(() => w.classList.remove('show'), 25000); }
  else { w.classList.remove('show'); clearTimeout(qrTimer); }
}

if (STEALTH) {
  const fxin = document.getElementById('fx');
  const HELP = '/shot /uno /find | /a45 /p70 /b2 /f ยิง | /u3 ลงไพ่ /d จั่ว /c R สี | /room /qr /pin1234 /join CODE /name ชื่อ';
  fxin.onkeydown = e => {
    if (e.key !== 'Enter') return;
    const v = fxin.value.trim(); fxin.value = '';
    if (!v) return;
    const low = v.toLowerCase(); let m;
    if (low === '/h') return toast(HELP);
    if (low === '/shot') return socket.emit('start', 'shot');
    if (low === '/uno') return socket.emit('start', 'uno');
    if (low === '/find') return socket.emit('start', 'find');
    if (low === '/d') return socket.emit('uno:draw');
    if (low === '/f') return socket.emit('fire', AIM);
    if (low === '/qr') return toggleQR();
    if (low === '/room') return toast('ROOM ' + ROOM + (PIN ? ' | PIN ' + PIN : '') + ' | ' + shareLink());
    if ((m = low.match(/^\/a\s*(\d+)$/))) { AIM.angle = Math.max(1, Math.min(89, +m[1])); return render(); }
    if ((m = low.match(/^\/p\s*(\d+)$/))) { AIM.power = Math.max(5, Math.min(100, +m[1])); return render(); }
    if ((m = low.match(/^\/b\s*(\d)$/)))  { AIM.ball = BK[+m[1]-1] || 'STD'; return render(); }
    if ((m = low.match(/^\/u\s*(\d+)$/))) { const c = HAND[+m[1]-1]; if (c) playCard(c.id); return; }
    if ((m = v.match(/^\/c\s*([RGBYrgby])$/))) {
      if (pendingWild == null) return toast('ยังไม่ได้เลือกไพ่ไวลด์');
      socket.emit('uno:play', { id: pendingWild, color: m[1].toUpperCase() }); pendingWild = null; return render();
    }
    if ((m = v.match(/^\/pin\s*(\S+)$/i))) { PIN = m[1]; localStorage.olPin = PIN; socket.emit('join', { roomId: ROOM, name: localStorage.olName || 'PC', cid: CID, pin: PIN }); return toast('PIN updated'); }
    if ((m = v.match(/^\/join\s+(\S+)$/i))) { localStorage.olRoom = m[1].toUpperCase(); location.href = '?r=' + encodeURIComponent(m[1].toUpperCase()) + (PIN ? '&k=' + encodeURIComponent(PIN) : ''); return; }
    if ((m = v.match(/^\/name\s+(.+)$/i))) { localStorage.olName = m[1].trim(); return location.reload(); }
    socket.emit('chat', v);
  };
  addEventListener('keydown', e => {
    const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'q') { toggleQR(); e.preventDefault(); return; }
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'g') { document.body.classList.remove('boss'); fxin.focus(); e.preventDefault(); return; }
    if (typing) { if (e.key === 'Escape') { document.activeElement.blur(); document.body.classList.add('boss'); } return; }
    if (e.key === 'Escape') { document.body.classList.toggle('boss'); return; }
    if (!S) return;
    if (e.key === 'ArrowLeft')  { AIM.angle = Math.max(1, AIM.angle - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { AIM.angle = Math.min(89, AIM.angle + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp')    { AIM.power = Math.min(100, AIM.power + 2); render(); e.preventDefault(); }
    if (e.key === 'ArrowDown')  { AIM.power = Math.max(5, AIM.power - 2); render(); e.preventDefault(); }
    if (e.key === ' ')          { socket.emit('fire', AIM); e.preventDefault(); }
    if (e.key === 'Tab')        { AIM.ball = BK[(BK.indexOf(AIM.ball) + 1) % BK.length]; render(); e.preventDefault(); }
  });
  addEventListener('blur', () => { document.body.classList.add('boss'); toggleQR(false); });
  document.getElementById('namebox').onkeydown = e => {
    if (e.key === 'Enter') { const v = e.target.value.trim().toUpperCase(); if (v) location.href = '?r=' + encodeURIComponent(v) + (PIN ? '&k=' + encodeURIComponent(PIN) : ''); }
  };
  render();
}
