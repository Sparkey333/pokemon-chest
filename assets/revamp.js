/* ============== Pokémon Chest — Revamp views ==============
   Adds five tabs on top of app.js (which owns State + helpers):
     🧊 3D Studio   — interactive 3D card viewer + 3D-print STL exports
     🏠 The Den     — a VR-style 3D display room, auto-loaded & editable
     💰 Best Sellers— what to sell, where: scoring + channel playbooks
     🏷 Brand Lab   — brand + packaging build-out for spare bulk cards
     📷 Scanner     — camera capture stored with the card file, phone mode,
                      PriceCharting bulk sync
   Loaded AFTER app.js; uses its globals ($, $$, esc, money, State, toast,
   openModal, phThumb, loadJSON …). All state keys are rv-prefixed. */
'use strict';

const LS_DEN = 'pokechest.den.v1';
const LS_CUSTOM = 'pokechest.customcards.v1';   // cards added in-app (not from the export)
const LS_SALES = 'pokechest.sales.v1';          // per-card sale records {pcId:{price,venue,fees,net,date,note}}

const RV = {
  data: {},                          // fetched json data files
  rendered: {},
  den: loadJSON(LS_DEN, { theme: 'amber', wall: 'top', shelf: 'graded', side: 'case', featured: 'auto' }),
  cam: { stream: null, deviceId: null, mirror: true },
  scan: { card: null },
  pcPoll: null,
};

async function rvData(name) {
  if (RV.data[name] !== undefined) return RV.data[name];
  try { RV.data[name] = await (await fetch('data/' + name + '.json?_=' + Date.now())).json(); }
  catch { RV.data[name] = null; }
  return RV.data[name];
}

function rvSaveDen() { try { localStorage.setItem(LS_DEN, JSON.stringify(RV.den)); } catch { } }

function rvThumb(c, cls) { return imgHTML(c, cls); }  // app.js helper: art or placeholder

function rvReady() { return State.cards && State.cards.length; }
function rvLoadingPanel(el, fn) {
  el.innerHTML = `<div class="panel" style="margin-top:20px"><p class="muted">Loading your collection…</p></div>`;
  setTimeout(() => { if (rvReady()) fn(); }, 600);
}

/* ---------- custom cards, sales & the archive ----------
   Cards you add in-app and sales you record live in localStorage (keyed by
   pcId, so they survive every export refresh). Archived cards stay saved —
   photos, sale data and all — but leave the collection totals & grids. */
function saleGet(c) { return loadJSON(LS_SALES, {})[c.pcId] || null; }
function saleSet(c, rec) {
  const all = loadJSON(LS_SALES, {});
  if (rec) all[c.pcId] = rec; else delete all[c.pcId];
  localStorage.setItem(LS_SALES, JSON.stringify(all));
}
function rvSoldCards() {
  return State.cards
    .filter(c => saleGet(c) || uget(c).status === 'sold')
    .sort((a, b) => ((saleGet(b) || {}).date || '').localeCompare((saleGet(a) || {}).date || ''));
}
function rvMergeCustom() {
  for (const cc of loadJSON(LS_CUSTOM, [])) {
    if (State.cards.some(c => String(c.pcId) === String(cc.pcId))) continue;
    const card = Object.assign({
      img: null, era: 'modern', game: 'Pokémon', pcUrl: null, setRaw: cc.set || 'Custom',
      setId: null, setYear: null, condition: cc.graded ? 'Graded' : 'Ungraded', wear: '',
      certId: null, datePurchased: null, grader: null, grade: null,
    }, cc);
    card.i = State.cards.length;
    card.fullName = card.name + (card.number ? ' #' + card.number : '');
    card.q = [card.lang === 'ja' ? 'Japanese' : '', card.name, card.number, card.set].filter(Boolean).join(' ');
    card.value = Math.round((card.price || 0) * (card.qty || 1) * 100) / 100;
    card.pl = Math.round((card.value - (card.cost || 0) * (card.qty || 1)) * 100) / 100;
    card.plPct = card.cost ? Math.round(card.pl / ((card.cost || 0) * (card.qty || 1)) * 1000) / 10 : null;
    State.cards.push(card);
  }
}
function rvRecalcMeta() {
  if (!State.meta) return;
  const act = State.cards.filter(c => !uget(c).archived);
  const m = State.meta;
  m.totalEntries = act.length;
  m.totalCards = act.reduce((a, c) => a + (c.qty || 1), 0);
  m.totalValue = Math.round(act.reduce((a, c) => a + (c.value || 0), 0) * 100) / 100;
  m.totalCost = Math.round(act.reduce((a, c) => a + (c.cost || 0) * (c.qty || 1), 0) * 100) / 100;
  m.totalPL = Math.round((m.totalValue - m.totalCost) * 100) / 100;
  const vp = $('#vpValue'); if (vp) vp.textContent = money0(m.totalValue);
}
(function hookDataLayer() {
  // archived cards leave every grid except an explicit "Sold" status filter
  const baseApply = window.applyFilters;
  window.applyFilters = function () {
    baseApply();
    if (State.filters.status !== 'sold') State.filtered = State.filtered.filter(c => !uget(c).archived);
  };
  // every (re)load — refresh, PC sync reload — re-merges customs & recounts
  const baseInit = window.init;
  window.init = async function () {
    await baseInit();
    rvMergeCustom(); rvRecalcMeta();
  };
  // the very first init() ran before this file loaded — patch it in once ready
  const t = setInterval(() => {
    if (rvReady()) { clearInterval(t); rvMergeCustom(); rvRecalcMeta(); try { renderDashboard(); } catch { } }
  }, 250);
})();

/* ---------- routing hook: lazy-render the new views ---------- */
const RV_VIEWS = {
  studio3d: () => renderStudio3d(),
  den: () => renderDen(),
  best: () => renderBest(),
  brand: () => renderBrand(),
  scan: () => renderScan(),
  ledger: () => renderLedger(),
};
(function hookSwitchView() {
  const base = window.switchView;
  window.switchView = function (v) {
    const prev = State.view;
    base(v);
    if (prev === 'scan' && v !== 'scan') rvCamStop();     // release the camera
    if (prev === 'den' && v !== 'den') rvDenStopLoop();
    const fn = RV_VIEWS[v];
    if (fn) {
      const el = $('#view-' + v);
      if (!rvReady()) return rvLoadingPanel(el, fn);
      try { fn(); } catch (e) { console.error(e); el.innerHTML = `<div class="panel"><p class="muted">This tab hit an error: ${esc(e.message)}</p></div>`; }
    }
  };
})();

/* ---------- shared card pickers ---------- */
function rvPickCards(source, n) {
  let arr = [...State.cards];
  const byValue = (a, b) => (b.value || 0) - (a.value || 0);
  switch (source) {
    case 'newest': arr.sort((a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || '')); break;
    case 'graded': arr = arr.filter(c => c.graded).sort(byValue); break;
    case 'ja': arr = arr.filter(c => c.lang === 'ja').sort(byValue); break;
    case 'vintage': arr = arr.filter(c => c.era === 'vintage').sort(byValue); break;
    case 'case': {
      const picks = loadJSON(LS_CASE, {});
      arr = arr.filter(c => picks[c.pcId]).sort(byValue);
      break;
    }
    case 'sold': arr = rvSoldCards(); break;
    default: arr.sort(byValue);
  }
  if (source !== 'sold') arr = arr.filter(c => !uget(c).archived);
  // visual displays look best with real art — art first, placeholders pad
  const withArt = arr.filter(c => c.img), noArt = arr.filter(c => !c.img);
  return withArt.concat(noArt).slice(0, n);
}
const RV_SOURCES = [
  ['top', 'Top value'], ['newest', 'Newest adds'], ['graded', 'Graded slabs'],
  ['ja', 'Japanese heat'], ['vintage', 'Vintage'], ['case', 'Display Case picks'],
  ['sold', 'Sold cards'],
];

/* ============================================================
   🧊 3D STUDIO — 3D card viewer + STL generator for 3D printing
   ============================================================ */
const ST3 = { card: null, spin: true, holo: true, rx: -8, ry: 22, drag: null };

function renderStudio3d() {
  const el = $('#view-studio3d');
  if (!ST3.card) ST3.card = rvPickCards('top', 1)[0] || State.cards[0];
  const top = rvPickCards('top', 14);
  el.innerHTML = `
  <div class="section-head"><div><h2>🧊 3D Studio</h2>
    <div class="sub">Turn any card into a 3D visual asset — spin it for videos &amp; thumbnails, then print a real display for it. Screen-record Showcase mode for YouTube Shorts.</div></div></div>
  <div class="st3-wrap">
    <div class="panel st3-side">
      <h3 style="margin-bottom:8px">Pick a card</h3>
      <input id="st3-q" class="s-inp" placeholder="Search name / set / number…" style="width:100%;margin-bottom:8px">
      <div id="st3-results" class="st3-results">
        ${top.map(c => `<button class="st3-pick" data-i="${c.i}" title="${esc(c.fullName)}">${rvThumb(c)}</button>`).join('')}
      </div>
      <div id="st3-info" class="st3-info"></div>
    </div>
    <div class="st3-stagecol">
      <div class="st3-stage" id="st3-stage">
        <div class="st3-scene" id="st3-scene">
          <div class="st3-card" id="st3-card">
            <div class="st3-face st3-front" id="st3-front"></div>
            <div class="st3-face st3-back">
              <div class="st3-backart"><span>⭐</span><b>POKÉMON CHEST</b><span class="reason">private collection</span></div>
            </div>
            <div class="st3-holo" id="st3-holo"></div>
          </div>
        </div>
        <button class="btn sm st3-exit" id="st3-exit">✕ exit showcase</button>
      </div>
      <div class="st3-controls">
        <label class="rv-check"><input type="checkbox" id="st3-spin" ${ST3.spin ? 'checked' : ''}> Auto-spin</label>
        <label class="rv-check"><input type="checkbox" id="st3-holoT" ${ST3.holo ? 'checked' : ''}> Holo foil</label>
        <button class="btn sm" id="st3-reset">Reset view</button>
        <button class="btn gold sm" id="st3-show">🎬 Showcase mode</button>
        <span class="reason">drag to rotate · double-click for card details</span>
      </div>
    </div>
    <div class="panel st3-side">
      <h3 style="margin-bottom:4px">🖨️ 3D-print a display</h3>
      <p class="reason" style="margin-bottom:10px">Generates a real, sliceable <b>.stl</b> (millimetres, Z-up) sized to this card — print it, then sell the card <i>with</i> its stand (see Brand Lab → Slab &amp; Stand Bundles).</p>
      <label class="s-lab">Card format</label>
      <select id="st3-fmt" class="s-inp" style="width:100%">
        <option value="66,91,1">Sleeved raw card (66 × 91 × 1 mm)</option>
        <option value="77,103,3.2">Toploader (77 × 103 × 3.2 mm)</option>
        <option value="65,108,9.5">PSA-style slab (65 × 108 × 9.5 mm)</option>
        <option value="custom">Custom…</option>
      </select>
      <div id="st3-custom" style="display:none;gap:6px" class="rv-row">
        <input id="st3-w" class="s-inp" type="number" value="66" min="20" max="200" title="width mm">
        <input id="st3-h" class="s-inp" type="number" value="91" min="20" max="250" title="height mm">
        <input id="st3-t" class="s-inp" type="number" value="1" min="0.4" max="25" step="0.1" title="thickness mm">
      </div>
      <div class="rv-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn primary sm" id="st3-stl-stand">⬇ Easel stand .stl</button>
        <button class="btn primary sm" id="st3-stl-frame">⬇ Wall frame .stl</button>
      </div>
      <p class="reason" style="margin-top:10px">Print tips: PLA, 0.2 mm layers, 3 walls, no supports (stand prints flat on its base). Your logo can be embossed later in any slicer.</p>
    </div>
  </div>`;

  const results = $('#st3-results');
  $('#st3-q').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    const list = q
      ? State.cards.filter(c => (c.name + ' ' + c.set + ' ' + (c.number || '')).toLowerCase().includes(q)).slice(0, 14)
      : top;
    results.innerHTML = list.map(c => `<button class="st3-pick" data-i="${c.i}" title="${esc(c.fullName)}">${rvThumb(c)}</button>`).join('') ||
      '<p class="reason">No matches.</p>';
    wirePicks();
  };
  const wirePicks = () => $$('.st3-pick', el).forEach(b => b.onclick = () => { ST3.card = State.cards[+b.dataset.i]; st3Update(); });
  wirePicks();

  // stage interactions
  const stage = $('#st3-stage'), cardEl = $('#st3-card');
  stage.onpointerdown = e => { ST3.drag = { x: e.clientX, y: e.clientY, rx: ST3.rx, ry: ST3.ry }; stage.setPointerCapture(e.pointerId); };
  stage.onpointermove = e => {
    if (!ST3.drag) return;
    ST3.ry = ST3.drag.ry + (e.clientX - ST3.drag.x) * 0.5;
    ST3.rx = Math.max(-70, Math.min(70, ST3.drag.rx - (e.clientY - ST3.drag.y) * 0.5));
    st3Apply();
  };
  stage.onpointerup = stage.onpointercancel = () => ST3.drag = null;
  stage.ondblclick = () => ST3.card && openModal(ST3.card);
  $('#st3-spin').onchange = e => { ST3.spin = e.target.checked; st3Apply(); };
  $('#st3-holoT').onchange = e => { ST3.holo = e.target.checked; st3Apply(); };
  $('#st3-reset').onclick = () => { ST3.rx = -8; ST3.ry = 22; st3Apply(); };
  $('#st3-show').onclick = () => { $('#st3-stage').classList.toggle('showcase'); ST3.spin = true; $('#st3-spin').checked = true; st3Apply(); };
  $('#st3-exit').onclick = e => { e.stopPropagation(); $('#st3-stage').classList.remove('showcase'); };
  $('#st3-fmt').onchange = e => $('#st3-custom').style.display = e.target.value === 'custom' ? 'flex' : 'none';
  $('#st3-stl-stand').onclick = () => st3Download('stand');
  $('#st3-stl-frame').onclick = () => st3Download('frame');

  function st3Apply() {
    cardEl.classList.toggle('spin', ST3.spin);
    $('#st3-holo').style.display = ST3.holo ? '' : 'none';
    if (!ST3.spin) cardEl.style.transform = `rotateX(${ST3.rx}deg) rotateY(${ST3.ry}deg)`;
    else cardEl.style.transform = '';
  }
  function st3Update() {
    const c = ST3.card;
    $('#st3-front').innerHTML = c.img
      ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" onerror="this.outerHTML=phHTML(${c.i})">` : phHTML(c.i);
    $('#st3-info').innerHTML = `
      <div class="st3-name">${esc(c.name)}${c.number ? ' <span class="reason">#' + esc(c.number) + '</span>' : ''}</div>
      <div class="reason">${esc(c.set)} · ${c.lang === 'ja' ? '🇯🇵' : '🇺🇸'} ${c.graded ? '· ' + esc(c.grader || '') + ' ' + esc(c.grade || '') : '· raw'}</div>
      <div class="st3-price">${money(c.price)}</div>`;
  }
  st3Update(); st3Apply();
}

/* ----- STL generation (ASCII, mm, Z-up) ----- */
function st3Dims() {
  const v = $('#st3-fmt').value;
  if (v === 'custom') return [+$('#st3-w').value || 66, +$('#st3-h').value || 91, +$('#st3-t').value || 1];
  return v.split(',').map(Number);
}
function stlHexa(v) {  // v: 8 vertices — bottom 0-3, top 4-7 (matching order)
  const q = (a, b, c, d) => [[v[a], v[b], v[c]], [v[a], v[c], v[d]]];
  return [...q(0, 3, 2, 1), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4), ...q(1, 2, 6, 5), ...q(2, 3, 7, 6), ...q(3, 0, 4, 7)];
}
function stlBox(x, y, z, w, d, h) {
  return stlHexa([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z],
  [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]);
}
function stlText(tris, name) {
  const f = n => (Math.round(n * 1000) / 1000).toString();
  const out = ['solid ' + name];
  for (const [a, b, c] of tris) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    out.push(` facet normal ${f(n[0] / L)} ${f(n[1] / L)} ${f(n[2] / L)}`, '  outer loop');
    for (const p of [a, b, c]) out.push(`   vertex ${f(p[0])} ${f(p[1])} ${f(p[2])}`);
    out.push('  endloop', ' endfacet');
  }
  out.push('endsolid ' + name);
  return out.join('\n');
}
function st3Stand(W, H, T) {
  // flat base + front lip + card slot + leaned back-rest plate (20° recline)
  const bw = W + 16, gap = T + 0.8, lipY = 8, lipD = 3, plate = 3.2;
  const restH = Math.min(H * 0.72, 85), lean = Math.tan(20 * Math.PI / 180) * restH;
  const slotY = lipY + lipD + gap;                       // rest front face
  const baseD = slotY + plate + lean + 10;
  const tris = [];
  tris.push(...stlBox(0, 0, 0, bw, baseD, 3));           // base
  tris.push(...stlBox(0, lipY, 3, bw, lipD, 9));         // front lip
  tris.push(...stlHexa([                                  // leaned back-rest
    [0, slotY, 3], [bw, slotY, 3], [bw, slotY + plate, 3], [0, slotY + plate, 3],
    [0, slotY + lean, 3 + restH], [bw, slotY + lean, 3 + restH],
    [bw, slotY + plate + lean, 3 + restH], [0, slotY + plate + lean, 3 + restH]]));
  return tris;
}
function st3Frame(W, H, T) {
  // wall/desk frame: floor slab + 4 walls forming a recessed pocket for the card
  const wall = 4, fw = W + 2 * wall + 1, fh = H + 2 * wall + 1, depth = T + 1.4;
  const tris = [];
  tris.push(...stlBox(0, 0, 0, fw, fh, 2));                           // back slab
  tris.push(...stlBox(0, 0, 2, fw, wall, depth));                     // bottom wall
  tris.push(...stlBox(0, fh - wall, 2, fw, wall, depth));             // top wall
  tris.push(...stlBox(0, wall, 2, wall, fh - 2 * wall, depth));       // left
  tris.push(...stlBox(fw - wall, wall, 2, wall, fh - 2 * wall, depth)); // right
  return tris;
}
function st3Download(kind) {
  const [W, H, T] = st3Dims();
  const tris = kind === 'stand' ? st3Stand(W, H, T) : st3Frame(W, H, T);
  const name = (ST3.card ? ST3.card.name : 'card').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([stlText(tris, 'pokechest_' + kind)], { type: 'model/stl' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chest-${kind}-${name || 'card'}-${W}x${H}mm.stl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`STL ready — ${kind === 'stand' ? 'easel stand' : 'wall frame'} sized ${W}×${H}×${T} mm`);
}

/* ============================================================
   🏠 THE DEN — VR-style display room (CSS 3D), editable displays
   ============================================================ */
const DEN = { yaw: 0, pitch: 4, zoom: 260, drag: null, orbit: false, raf: null };

function renderDen() {
  const el = $('#view-den');
  const d = RV.den;
  const sel = (id, val, opts, extra) => `<select id="${id}" class="s-inp den-sel" title="${extra || ''}">${opts.map(([v, l]) => `<option value="${v}"${v === String(val) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const featuredOpts = [['auto', '⭐ Auto (top card)']].concat(rvPickCards('top', 20).map(c => [String(c.pcId), c.name + ' — ' + money0(c.price)]));
  el.innerHTML = `
  <div class="section-head"><div><h2>🏠 The Den</h2>
    <div class="sub">Your collection as a walk-in display room — drag to look, scroll to walk, click any card. Every display auto-loads and is editable below.</div></div>
    <div class="rv-row">
      <button class="btn sm" id="den-cam">📷 Den Cam</button>
      <button class="btn sm" id="den-orbit">🎥 Auto-orbit</button>
      <button class="btn ghost sm" id="den-reset">Reset view</button>
    </div></div>
  <div class="den-bar panel">
    <span class="tlabel">Theme</span>${sel('den-theme', d.theme, [['amber', '🟠 Amber Den'], ['midnight', '🌙 Midnight'], ['neon', '🕹 Neon Arcade']])}
    <span class="tlabel">Trophy wall</span>${sel('den-wall', d.wall, RV_SOURCES)}
    <span class="tlabel">Slab shelf</span>${sel('den-shelf', d.shelf, RV_SOURCES)}
    <span class="tlabel">Side gallery</span>${sel('den-side', d.side, RV_SOURCES)}
    <span class="tlabel">Pedestal</span>${sel('den-feat', d.featured, featuredOpts)}
  </div>
  <div class="den-viewport theme-${esc(d.theme)}" id="den-vp">
    <div class="den-world" id="den-world">${denRoomHTML()}</div>
    <div class="den-hud"><span>drag — look</span><span>scroll — walk</span><span>click card — details</span></div>
  </div>`;

  $('#den-cam').onclick = () => switchView('scan');
  $('#den-reset').onclick = () => { DEN.yaw = 0; DEN.pitch = 4; DEN.zoom = 260; denApply(); };
  $('#den-orbit').onclick = () => { DEN.orbit = !DEN.orbit; $('#den-orbit').classList.toggle('primary', DEN.orbit); denLoop(); };
  $('#den-theme').onchange = e => { RV.den.theme = e.target.value; rvSaveDen(); $('#den-vp').className = 'den-viewport theme-' + e.target.value; };
  const rebind = (id, key) => $('#' + id).onchange = e => { RV.den[key] = e.target.value; rvSaveDen(); renderDen(); };
  rebind('den-wall', 'wall'); rebind('den-shelf', 'shelf'); rebind('den-side', 'side'); rebind('den-feat', 'featured');

  const vp = $('#den-vp');
  vp.onpointerdown = e => { DEN.drag = { x: e.clientX, y: e.clientY, yaw: DEN.yaw, pitch: DEN.pitch, moved: 0 }; vp.setPointerCapture(e.pointerId); };
  vp.onpointermove = e => {
    if (!DEN.drag) return;
    const dx = e.clientX - DEN.drag.x, dy = e.clientY - DEN.drag.y;
    DEN.drag.moved = Math.max(DEN.drag.moved, Math.abs(dx) + Math.abs(dy));
    DEN.yaw = Math.max(-70, Math.min(70, DEN.drag.yaw - dx * 0.15));
    DEN.pitch = Math.max(-6, Math.min(26, DEN.drag.pitch + dy * 0.1));
    denApply();
  };
  vp.onpointerup = vp.onpointercancel = () => setTimeout(() => DEN.drag = null, 0);
  vp.onwheel = e => { e.preventDefault(); DEN.zoom = Math.max(40, Math.min(620, DEN.zoom + (e.deltaY < 0 ? 40 : -40))); denApply(); };
  vp.onclick = e => {
    if (DEN.drag && DEN.drag.moved > 6) return;          // that was a drag, not a click
    const t = e.target.closest('[data-i]');
    if (t) openModal(State.cards[+t.dataset.i]);
  };
  denApply();
}
function denApply() {
  const w = $('#den-world');
  if (w) w.style.transform = `translateZ(${DEN.zoom}px) rotateX(${DEN.pitch}deg) rotateY(${DEN.yaw}deg)`;
}
function denLoop() {
  rvDenStopLoop();
  if (!DEN.orbit) return denApply();
  let t0 = performance.now();
  const step = (t) => {
    DEN.yaw = Math.sin((t - t0) / 6000) * 34;
    denApply();
    DEN.raf = requestAnimationFrame(step);
  };
  DEN.raf = requestAnimationFrame(step);
}
function rvDenStopLoop() { if (DEN.raf) cancelAnimationFrame(DEN.raf); DEN.raf = null; }

function denRoomHTML() {
  const wallCards = rvPickCards(RV.den.wall, 6);
  const shelfCards = rvPickCards(RV.den.shelf, 8);
  const sideCards = rvPickCards(RV.den.side, 6);
  let feat = null;
  if (RV.den.featured !== 'auto') feat = State.cards.find(c => String(c.pcId) === String(RV.den.featured));
  if (!feat) feat = rvPickCards('top', 1)[0];
  const meta = State.meta || {};
  const movers = rvPickCards('top', 4).map(c => `${esc(c.name)} ${money0(c.price)}`).join('  ·  ');
  const frame = (c, cls) => {
    const sale = cls === 'soldcard' ? saleGet(c) : null;
    return `<div class="den-card ${cls || ''}" data-i="${c.i}" title="${esc(c.fullName)} — ${money(c.price)}">${rvThumb(c)}${c.graded && cls !== 'soldcard' ? `<span class="den-slabtag">${esc(c.grader || 'GRADED')} ${esc(c.grade || '')}</span>` : ''}${cls === 'soldcard' ? `<span class="den-soldtag">SOLD${sale && sale.price ? ' ' + money0(sale.price) : ''}</span>` : ''}</div>`;
  };
  const soldCards = rvPickCards('sold', 5);
  return `
    <div class="den-face den-floor"></div>
    <div class="den-face den-ceil"></div>
    <div class="den-face den-back"></div>
    <div class="den-face den-left"></div>
    <div class="den-face den-right"></div>
    <div class="den-rug"></div>
    <div class="den-ticker"><div class="den-ticker-in">PORTFOLIO ${money0(meta.totalValue)} · ${(meta.totalEntries || 0).toLocaleString()} CARDS · TOP: ${movers} · </div></div>
    <div class="den-display den-trophy">
      <div class="den-disp-title">🏆 Trophy Wall</div>
      <div class="den-trophy-row">${wallCards.map(c => frame(c, 'framed')).join('')}</div>
    </div>
    <div class="den-display den-shelfwall">
      <div class="den-disp-title">🧊 Slab Shelf</div>
      <div class="den-shelf-row">${shelfCards.slice(0, 4).map(c => frame(c, 'slab')).join('')}</div>
      <div class="den-shelf-plank"></div>
      <div class="den-shelf-row">${shelfCards.slice(4, 8).map(c => frame(c, 'slab')).join('')}</div>
      <div class="den-shelf-plank"></div>
    </div>
    <div class="den-display den-gallery">
      <div class="den-disp-title">🖼️ Gallery</div>
      <div class="den-gallery-grid">${sideCards.map(c => frame(c, 'framed')).join('')}</div>
    </div>
    ${soldCards.length ? `<div class="den-display den-soldshelf">
      <div class="den-disp-title">💸 Sold Shelf</div>
      <div class="den-shelf-row">${soldCards.map(c => frame(c, 'soldcard')).join('')}</div>
      <div class="den-shelf-plank"></div>
    </div>` : ''}
    <div class="den-sign">THE DEN</div>
    <div class="den-pedestal"><div class="den-ped-top"></div><div class="den-ped-col"></div></div>
    <div class="den-featured">
      <div class="den-feat-spin">
        <div class="den-feat-face">${rvThumb(feat)}</div>
        <div class="den-feat-face den-feat-backface"><div class="st3-backart"><span>⭐</span><b>POKÉMON CHEST</b></div></div>
      </div>
      <div class="den-feat-label" data-i="${feat.i}">${esc(feat.name)} · ${money0(feat.price)}</div>
    </div>`;
}

/* ============================================================
   💰 BEST SELLERS — what to sell + where (auctions/live/YouTube)
   ============================================================ */
const BEST = { includeGraded: true, min: 10 };

async function renderBest() {
  const el = $('#view-best');
  const bs = await rvData('best-sellers');
  const sc = (bs && bs.scoring) || {};
  const bands = sc.priceBands || [
    { min: 0, max: 10, factor: 0.25, label: 'Bulk zone', advice: 'Feed into lots & Brand Lab packaging.' },
    { min: 10, max: 25, factor: 0.7, label: 'Slow singles', advice: 'Sell in lots or live streams.' },
    { min: 25, max: 100, factor: 1.25, label: 'Sweet spot', advice: 'Fastest movers.' },
    { min: 100, max: 400, factor: 1.15, label: 'Serious buyers', advice: 'Crisp photos required.' },
    { min: 400, max: 99999, factor: 0.9, label: 'Big tickets', advice: 'Auction for price discovery.' }];
  const band = p => bands.find(b => p >= b.min && p < b.max) || bands[bands.length - 1];
  const setHeat = c => {
    for (const s of (sc.setHeat || [])) if ((c.set || '').toLowerCase().includes(s.match.toLowerCase())) return s;
    return null;
  };
  const score = c => {
    const p = c.price || 0;
    if (!p) return 0;
    let s = (c.value || p) * band(p).factor
      * ((sc.eraHeat || {})[c.era] || 1)
      * ((sc.langFactor || {})[c.lang] || 1);
    const h = setHeat(c); if (h) s *= h.factor;
    if (c.graded) s *= sc.gradedBonus || 1.15;
    return s;
  };
  const sellable = State.cards
    .filter(c => (c.price || 0) >= BEST.min && (BEST.includeGraded || !c.graded)
      && uget(c).status !== 'sold' && !uget(c).archived && !saleGet(c))
    .map(c => ({ c, s: score(c), b: band(c.price || 0), h: setHeat(c) }))
    .sort((a, b) => b.s - a.s);
  const board = sellable.slice(0, 25);
  const sweet = sellable.filter(x => x.b.label === 'Sweet spot');
  const anchors = sellable.filter(x => (x.c.price || 0) >= 100);
  const channels = (bs && bs.channels) || [];
  const chanBy = k => channels.find(ch => ch.key === k);
  const suggest = (c) => {
    const p = c.price || 0;
    if (p >= 400) return { key: 'ebay-auction', label: '🔨 eBay auction', why: 'price discovery' };
    if (p >= 100) return { key: 'ebay-auction', label: '🔨 Auction night', why: 'anchor lot' };
    if (p >= 25) return { key: 'ebay-bin', label: '🏷️ eBay BIN / Whatnot', why: 'sweet spot' };
    if (p >= 10) return { key: 'whatnot', label: '📺 Live lots', why: 'stream filler' };
    return { key: 'brand', label: '🧰 Brand Lab packs', why: 'bulk → product' };
  };
  const net = (c, key) => {
    const ch = chanBy(key === 'brand' ? 'whatnot' : key) || { feePct: 13, feeFlat: 0.3 };
    return Math.max(0, (c.price || 0) * (1 - (ch.feePct || 0) / 100) - (ch.feeFlat || 0));
  };
  const kpi = (label, v, sub, cls) => `<div class="kpi ${cls || ''}"><div class="k-label">${label}</div><div class="k-value">${v}</div><div class="k-sub">${sub}</div></div>`;

  el.innerHTML = `
  <div class="section-head"><div><h2>💰 Best Sellers</h2>
    <div class="sub">The cards most worth selling <i>right now</i> — scored for liquidity, matched to the venue (bidding, live, YouTube) where each will do best.</div></div>
    <div class="rv-row">
      <label class="rv-check"><input type="checkbox" id="bs-graded" ${BEST.includeGraded ? 'checked' : ''}> include graded</label>
      <span class="tlabel">min $</span><input id="bs-min" class="s-inp" type="number" style="width:80px" value="${BEST.min}">
    </div></div>
  <div class="kpis">
    ${kpi('Top-25 board value', money0(board.reduce((a, x) => a + (x.c.value || 0), 0)), 'if the whole board sold at ask', 'k-gold')}
    ${kpi('Sweet-spot cards', sweet.length.toLocaleString(), '$25–$100 · fastest sell-through', 'k-green')}
    ${kpi('Auction anchors', anchors.length.toLocaleString(), '$100+ · Sunday auction night', 'k-blue')}
    ${kpi('Weekly live lot', money0(sellable.slice(25, 85).reduce((a, x) => a + (x.c.value || 0), 0)), 'next 60 cards → one 2-hr stream', '')}
  </div>
  <div class="panel" style="margin-top:14px">
    <h3>The Best-Sell Board</h3>
    <p class="reason">score = value × price-band × era × set-heat ${bs ? '' : '(defaults — data file missing)'} — net shown after the suggested venue's fees${bs ? '' : ''}.</p>
    <div class="rv-tablewrap"><table class="rv-table">
      <thead><tr><th></th><th>Card</th><th>Ask</th><th>Band</th><th>Why it moves</th><th>Sell it via</th><th>Est. net</th><th></th></tr></thead>
      <tbody>${board.map((x, i) => {
    const sg = suggest(x.c);
    return `<tr>
        <td class="rv-rank">${i + 1}</td>
        <td class="rv-cardcell"><span class="rv-thumb" data-i="${x.c.i}">${rvThumb(x.c)}</span>
          <div><b>${esc(x.c.name)}</b>${x.c.number ? ' <span class="reason">#' + esc(x.c.number) + '</span>' : ''}<br>
          <span class="reason">${esc(x.c.set)} ${x.c.graded ? '· ' + esc(x.c.grader || '') + ' ' + esc(x.c.grade || '') : ''}</span></div></td>
        <td><b>${money(x.c.price)}</b></td>
        <td><span class="rv-band">${esc(x.b.label)}</span></td>
        <td class="reason">${x.h ? esc(x.h.why) : esc(x.b.advice)}</td>
        <td>${sg.label}<br><span class="reason">${sg.why}</span></td>
        <td class="rv-net">${money(net(x.c, sg.key))}</td>
        <td><button class="minilink rv-open" data-i="${x.c.i}">open ↗</button></td>
      </tr>`;
  }).join('')}</tbody>
    </table></div>
  </div>
  <h3 style="margin:22px 0 10px">Where to sell — the channel matrix</h3>
  <div class="rv-cards">${channels.map(ch => `
    <div class="panel rv-chan">
      <div class="rv-chan-head">${ch.icon} <b>${esc(ch.name)}</b>
        <span class="rv-fee">${ch.feePct ? ch.feePct + '% + $' + (ch.feeFlat || 0).toFixed(2) : 'no fees'}</span></div>
      <p><b style="color:var(--green)">Best for:</b> ${esc(ch.bestFor)}</p>
      <p><b style="color:var(--red)">Avoid:</b> ${esc(ch.avoid)}</p>
      <ul class="rv-ul">${(ch.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p class="reason">payout: ${esc(ch.payout)}</p>
    </div>`).join('') || '<p class="reason">Channel data file missing — run from the app folder.</p>'}
  </div>
  ${bs && bs.auctionNight ? `<div class="rv-2col">
    <div class="panel"><h3>${esc(bs.auctionNight.title)}</h3><ol class="rv-ol">${bs.auctionNight.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
    <div class="panel"><h3>${esc(bs.livePlaybook.title)}</h3><ol class="rv-ol">${bs.livePlaybook.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>
  </div>` : ''}
  ${bs && bs.notes ? `<p class="reason" style="margin-top:12px">${bs.notes.map(esc).join(' · ')}</p>` : ''}`;

  $('#bs-graded').onchange = e => { BEST.includeGraded = e.target.checked; renderBest(); };
  $('#bs-min').onchange = e => { BEST.min = +e.target.value || 0; renderBest(); };
  $$('.rv-open, .rv-thumb', el).forEach(b => b.onclick = () => openModal(State.cards[+b.dataset.i]));
}

/* ============================================================
   🏷 BRAND LAB — brand + packaging build-out for the bulk mountain
   ============================================================ */
async function renderBrand() {
  const el = $('#view-brand');
  const bl = await rvData('brand-lab');
  if (!bl) {
    el.innerHTML = '<div class="panel" style="margin-top:20px"><p class="muted">data/brand-lab.json missing — pull the latest app files.</p></div>';
    return;
  }
  // how much bulk feeds the machine
  const bulk = State.cards.filter(c => (c.price || 0) < 10);
  const bulkQty = bulk.reduce((a, c) => a + (c.qty || 1), 0);
  const mid = State.cards.filter(c => (c.price || 0) >= 10 && (c.price || 0) < 25);
  const copyBtn = (txt, label) => `<button class="minilink rv-copy" data-txt="${esc(txt)}">${label || '📋 copy'}</button>`;
  const risk = r => `<span class="rv-risk ${r}">${r === 'high' ? '⚠ IP risk' : '✓ safe'}</span>`;

  el.innerHTML = `
  <div class="section-head"><div><h2>🏷 Brand Lab</h2>
    <div class="sub">${esc(bl.brand.positioning)}</div></div></div>
  <div class="kpis">
    <div class="kpi k-gold"><div class="k-label">Bulk to package</div><div class="k-value">${bulkQty.toLocaleString()}</div><div class="k-sub">cards under $10 in this export — plus your unlisted spare boxes</div></div>
    <div class="kpi k-green"><div class="k-label">Pack "hits" ready</div><div class="k-value">${mid.length.toLocaleString()}</div><div class="k-sub">$10–$25 cards to seed Mystery Chests</div></div>
    <div class="kpi k-blue"><div class="k-label">Product lines</div><div class="k-value">${bl.packagingLines.length}</div><div class="k-sub">start with ONE — the sample run tells you which</div></div>
  </div>

  <div class="panel" style="margin-top:14px;border-color:var(--gold-dim)">
    <h3>⚖️ ${esc(bl.ipSafety.title)}</h3>
    <ul class="rv-ul">${bl.ipSafety.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
  </div>

  <div class="rv-2col" style="margin-top:14px">
    <div class="panel">
      <h3>The brand</h3>
      <table class="rv-table"><thead><tr><th>Name</th><th>Why</th><th></th></tr></thead><tbody>
        ${bl.brand.nameCandidates.map(n => `<tr><td><b>${esc(n.name)}</b></td><td class="reason">${esc(n.why)}</td><td>${risk(n.risk)}</td></tr>`).join('')}
      </tbody></table>
      <p style="margin-top:10px"><b>Taglines:</b></p>
      <ul class="rv-ul">${bl.brand.taglines.map(t => `<li>“${esc(t)}” ${copyBtn(t)}</li>`).join('')}</ul>
      <p style="margin-top:10px"><b>Voice:</b> <span class="reason">${esc(bl.brand.voice)}</span></p>
      <div class="rv-row" style="margin-top:10px;flex-wrap:wrap">
        ${bl.brand.colorSystem.map(c => `<span class="rv-swatch" title="${esc(c.use)}"><i style="background:${esc(c.hex)}"></i>${esc(c.name)} ${esc(c.hex)}</span>`).join('')}
      </div>
    </div>
    <div class="panel">
      <h3>🎨 Generate the art</h3>
      <p class="reason">Original, IP-safe logo prompts — paste into your image generator of choice (or hand them to a designer):</p>
      ${bl.brand.logoPrompts.map(p => `<div class="rv-prompt">${esc(p)} ${copyBtn(p)}</div>`).join('')}
      <h3 style="margin-top:14px">${esc(bl.artPipeline.title)}</h3>
      <ol class="rv-ol">${bl.artPipeline.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <table class="rv-table" style="margin-top:8px"><thead><tr><th>Item</th><th>Where</th><th>Cost</th></tr></thead><tbody>
        ${bl.artPipeline.printCategories.map(p => `<tr><td>${esc(p.item)}</td><td class="reason">${esc(p.vendorType)}</td><td>${esc(p.cost)}</td></tr>`).join('')}
      </tbody></table>
    </div>
  </div>

  <h3 style="margin:22px 0 10px">📦 Packaging lines — millions of spare cards → products</h3>
  <div class="rv-cards">${bl.packagingLines.map(p => `
    <div class="panel rv-pack ${p.tier === 'hero' ? 'rv-hero' : ''}">
      <div class="rv-chan-head">${p.icon} <b>${esc(p.name)}</b><span class="rv-fee">${esc(p.tier)}</span></div>
      <p>${esc(p.what)}</p>
      <p class="reason"><b>Feeds on:</b> ${esc(p.uses)}</p>
      <div class="rv-row" style="gap:14px"><span><b style="color:var(--gold)">${esc(p.pricePoint)}</b> <span class="reason">retail</span></span>
      <span class="reason">cost ${esc(p.unitCost)}</span></div>
      <p style="margin-top:6px"><b style="color:var(--accent)">Stand-out:</b> ${esc(p.standout)}</p>
    </div>`).join('')}
  </div>

  <h3 style="margin:22px 0 10px">✨ Stand-out moves</h3>
  <div class="rv-cards">${bl.standout.map(s => `<div class="panel"><p>${s.icon} ${esc(s.idea)}</p></div>`).join('')}</div>

  <div class="panel" style="margin-top:14px">
    <h3>🗺️ Roadmap</h3>
    <div class="rv-2col">${bl.roadmap.map(r => `<div><b style="color:var(--gold)">${esc(r.phase)}</b><ul class="rv-ul">${r.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
  </div>
  <p class="reason" style="margin-top:12px">${esc(bl.about)}</p>`;

  $$('.rv-copy', el).forEach(b => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.txt); toast('Copied.'); }
    catch { toast('Clipboard blocked — select & copy manually.'); }
  });
}

/* ============================================================
   📷 SCANNER — camera → photo stored with the card file, phone
   mode (LAN + QR), PriceCharting bulk sync
   ============================================================ */
function renderScan() {
  const el = $('#view-scan');
  const live = !!State.live;
  el.innerHTML = `
  <div class="section-head"><div><h2>📷 Scanner</h2>
    <div class="sub">Hold a card up to your Mac camera (or your phone's), snap it, and the photo is stored with that card's file — ready for listings, provenance QRs, and sale builds.</div></div></div>
  ${live ? '' : `<div class="panel" style="border-color:var(--red-dim);margin-bottom:12px"><p class="muted">⚠ Static mode — photos can't be saved. Launch via <b>start.command</b> (or the app) to enable the Scanner.</p></div>`}
  <div class="rv-2col rv-scangrid">
    <div class="panel">
      <h3>1 · Pick the card</h3>
      <input id="sc-q" class="s-inp" style="width:100%" placeholder="Search your ${(State.meta && State.meta.totalEntries || 0).toLocaleString()} cards…">
      <div id="sc-results" class="sc-results"></div>
      <div id="sc-selected" class="sc-selected"></div>
      <div id="sc-gallery" class="sc-gallery"></div>
    </div>
    <div class="panel">
      <h3>2 · Frame it &amp; snap</h3>
      <div class="sc-camwrap">
        <video id="sc-video" autoplay playsinline muted class="${RV.cam.mirror ? 'mirror' : ''}"></video>
        <div class="sc-guide"></div>
        <div id="sc-flash"></div>
      </div>
      <div class="rv-row" style="margin-top:10px;flex-wrap:wrap">
        <button class="btn primary" id="sc-start">🎥 Start camera</button>
        <button class="btn gold" id="sc-snap" disabled>📸 Capture &amp; save</button>
        <select id="sc-device" class="s-inp" style="max-width:200px" title="Camera — your iPhone shows up here via Continuity"></select>
        <label class="rv-check"><input type="checkbox" id="sc-mirror" ${RV.cam.mirror ? 'checked' : ''}> mirror</label>
      </div>
      <p class="reason" style="margin-top:8px">Tip: your iPhone appears in the camera list automatically (Continuity Camera). Fill the guide frame, avoid glare, snap. Each capture saves as the card's next <code>scan-N</code> photo.</p>
      <div class="rv-row" style="margin-top:6px">
        <label class="btn sm" style="cursor:pointer">📱 Or take/upload a photo
          <input id="sc-file" type="file" accept="image/*" capture="environment" style="display:none"></label>
        <button class="btn sm" id="sc-studio" disabled>🎬 Guided Photo Studio</button>
      </div>
    </div>
  </div>
  <div class="rv-2col" style="margin-top:14px">
    <div class="panel">
      <h3>📱 Phone mode — scan from anywhere in the room</h3>
      <p class="reason">Turns on a LAN address so your phone (same Wi-Fi) opens this exact app — Scanner included. Home networks only.</p>
      <div id="sc-lan">${live ? '<p class="reason">Checking…</p>' : '<p class="reason">Needs the local server (start.command).</p>'}</div>
    </div>
    <div class="panel">
      <h3>🔄 PriceCharting sync</h3>
      <p class="reason">With your PriceCharting API token (⚙ Live), re-price the whole collection straight from their API — no export download. The xlsx export + ↻ Refresh flow still works as the no-key fallback, and is still the way to pull <i>new</i> cards you've added to your PriceCharting collection.</p>
      <div id="sc-pc">${live ? '<p class="reason">Checking…</p>' : '<p class="reason">Needs the local server (start.command).</p>'}</div>
    </div>
  </div>`;

  /* --- card picking --- */
  const results = $('#sc-results');
  const renderResults = list => {
    results.innerHTML = list.map(c => `<button class="sc-res" data-i="${c.i}">${rvThumb(c)}<span><b>${esc(c.name)}</b>${c.number ? ' #' + esc(c.number) : ''}<br><span class="reason">${esc(c.set)} · ${money(c.price)}</span></span></button>`).join('')
      || '<p class="reason" style="padding:8px">No matches.</p>';
    $$('.sc-res', results).forEach(b => b.onclick = () => scSelect(State.cards[+b.dataset.i]));
  };
  $('#sc-q').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { results.innerHTML = '<p class="reason" style="padding:8px">Type to search — or snap first and pick after.</p>'; return; }
    renderResults(State.cards.filter(c => (c.name + ' ' + c.set + ' ' + (c.number || '')).toLowerCase().includes(q)).slice(0, 8));
  };
  $('#sc-q').oninput({ target: $('#sc-q') });
  if (RV.scan.card) scSelect(RV.scan.card);

  /* --- camera --- */
  $('#sc-start').onclick = () => rvCamStart();
  $('#sc-device').onchange = e => { RV.cam.deviceId = e.target.value || null; if (RV.cam.stream) rvCamStart(); };
  $('#sc-mirror').onchange = e => { RV.cam.mirror = e.target.checked; $('#sc-video').classList.toggle('mirror', RV.cam.mirror); };
  $('#sc-snap').onclick = scCapture;
  $('#sc-file').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (!RV.scan.card) return toast('Pick the card first (step 1) so the photo files with it.');
    scSave(await blobToDataUrl(f));
    e.target.value = '';
  };
  $('#sc-studio').onclick = () => RV.scan.card && window.openPhotoStudio && openPhotoStudio(RV.scan.card);

  if (live) { scRenderLan(); scRenderPc(); }
}

function scSelect(c) {
  RV.scan.card = c;
  $('#sc-selected').innerHTML = `<div class="sc-sel-card">${rvThumb(c)}<div><b>${esc(c.name)}</b>${c.number ? ' <span class="reason">#' + esc(c.number) + '</span>' : ''}<br><span class="reason">${esc(c.set)} · ${money(c.price)}</span><br><button class="minilink" id="sc-open">open card ↗</button></div></div>`;
  $('#sc-open').onclick = () => openModal(c);
  const st = $('#sc-studio'); if (st) st.disabled = !State.live;
  scGallery();
}
async function scGallery() {
  const c = RV.scan.card, g = $('#sc-gallery');
  if (!c || !g) return;
  if (!State.live) { g.innerHTML = ''; return; }
  try {
    const j = await (await fetch('/api/listingphotos?pcId=' + enc(c.pcId), { cache: 'no-store' })).json();
    const entries = Object.entries((j && j.photos) || {});
    g.innerHTML = `<div class="reason" style="margin:8px 0 4px">${entries.length} photo${entries.length === 1 ? '' : 's'} on file${entries.length ? ' — stored with this card' : ''}</div>
      <div class="sc-gal-grid">${entries.map(([slot, p]) => `
        <figure class="sc-shot"><img src="${esc(p)}?t=${Date.now()}" alt="${esc(slot)}">
        <figcaption>${esc(slot)} <button class="minilink sc-del" data-slot="${esc(slot)}">✕</button></figcaption></figure>`).join('')}</div>`;
    $$('.sc-del', g).forEach(b => b.onclick = async () => {
      await fetch('/api/listingphoto/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pcId: c.pcId, slot: b.dataset.slot }) });
      scGallery();
    });
  } catch { g.innerHTML = ''; }
}
async function rvCamStart() {
  rvCamStop();
  const video = $('#sc-video');
  try {
    const constraints = { audio: false, video: RV.cam.deviceId ? { deviceId: { exact: RV.cam.deviceId }, width: { ideal: 1920 } } : { facingMode: 'environment', width: { ideal: 1920 } } };
    RV.cam.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = RV.cam.stream;
    $('#sc-snap').disabled = false;
    $('#sc-start').textContent = '⏹ Stop camera';
    $('#sc-start').onclick = () => { rvCamStop(); };
    // labels only populate after permission — refresh the device list now
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    $('#sc-device').innerHTML = devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === RV.cam.deviceId ? ' selected' : ''}>${esc(d.label || 'Camera ' + (i + 1))}</option>`).join('');
    if (!RV.cam.deviceId && devs[0]) RV.cam.deviceId = devs[0].deviceId;
  } catch (e) {
    toast(location.protocol === 'http:' && !/^(127\.|localhost)/.test(location.hostname)
      ? 'Live camera needs the HTTPS phone-mode link — or use “take/upload a photo” below.'
      : 'Camera blocked: ' + e.message);
  }
}
function rvCamStop() {
  if (RV.cam.stream) { RV.cam.stream.getTracks().forEach(t => t.stop()); RV.cam.stream = null; }
  const v = $('#sc-video'); if (v) v.srcObject = null;
  const snap = $('#sc-snap'); if (snap) snap.disabled = true;
  const st = $('#sc-start'); if (st) { st.textContent = '🎥 Start camera'; st.onclick = () => rvCamStart(); }
}
function scCapture() {
  const video = $('#sc-video');
  if (!RV.cam.stream || !video.videoWidth) return toast('Start the camera first.');
  if (!RV.scan.card) return toast('Pick the card first (step 1) so the photo files with it.');
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(video.videoWidth * scale);
  cv.height = Math.round(video.videoHeight * scale);
  const ctx = cv.getContext('2d');
  if (RV.cam.mirror) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, cv.width, cv.height);
  const flash = $('#sc-flash');
  if (flash) { flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 220); }
  scSave(cv.toDataURL('image/jpeg', 0.92));
}
async function scSave(dataUrl) {
  const c = RV.scan.card;
  if (!State.live) return toast('Static mode — launch via start.command to save photos.');
  try {
    const j = await (await fetch('/api/listingphotos?pcId=' + enc(c.pcId), { cache: 'no-store' })).json();
    let n = 1;
    for (const slot of Object.keys((j && j.photos) || {})) {
      const m = /^scan-(\d+)$/.exec(slot);
      if (m) n = Math.max(n, +m[1] + 1);
    }
    const r = await (await fetch('/api/listingphoto', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pcId: c.pcId, slot: 'scan-' + n, dataUrl })
    })).json();
    if (r.ok) { toast(`Saved to ${c.name} — scan-${n} (${r.kb} KB)`); scGallery(); }
    else toast('Save failed: ' + (r.error || 'unknown'));
  } catch (e) { toast('Save error: ' + e.message); }
}

/* --- phone mode (LAN + QR) --- */
async function scRenderLan() {
  const box = $('#sc-lan'); if (!box) return;
  let st = null;
  try { st = await (await fetch('/api/lan', { cache: 'no-store' })).json(); } catch { }
  if (!st) { box.innerHTML = '<p class="reason">LAN status unavailable.</p>'; return; }
  if (!st.enabled) {
    box.innerHTML = `<button class="btn primary" id="sc-lan-on">📶 Turn on phone mode</button>
      <p class="reason" style="margin-top:8px">Starts a same-Wi-Fi address (HTTPS when possible) on port ${st.port}. Turn it off when you're done.</p>`;
    $('#sc-lan-on').onclick = async () => {
      $('#sc-lan-on').textContent = 'Starting…';
      await fetch('/api/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      scRenderLan();
    };
    return;
  }
  const url = st.urls[0] || '';
  box.innerHTML = `
    <div class="rv-row" style="align-items:flex-start;gap:16px;flex-wrap:wrap">
      ${url ? `<img class="sc-qr" alt="QR to open on your phone" src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${enc(url)}" onerror="this.remove()">` : ''}
      <div>
        <p><b style="color:var(--green)">● Phone mode is ON</b> ${st.tls ? '<span class="reason">(HTTPS — live camera works)</span>' : '<span class="reason">(HTTP — use the “take a photo” button on the phone)</span>'}</p>
        ${st.urls.map(u => `<p style="font-size:16px"><a href="${esc(u)}" target="_blank" rel="noopener"><b>${esc(u)}</b></a></p>`).join('') || '<p class="reason">No LAN IP found — is Wi-Fi on?</p>'}
        <p class="reason">Scan the QR or type the address on your phone (same Wi-Fi).${st.tls ? ' First visit: accept the self-signed certificate warning — it’s your own Mac.' : ''}</p>
        <button class="btn ghost sm" id="sc-lan-off" style="margin-top:6px">Turn off</button>
      </div>
    </div>`;
  $('#sc-lan-off').onclick = async () => {
    await fetch('/api/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    scRenderLan();
  };
}

/* --- PriceCharting sync --- */
async function scRenderPc() {
  const box = $('#sc-pc'); if (!box) return;
  if (RV.pcPoll) { clearInterval(RV.pcPoll); RV.pcPoll = null; }
  const hasToken = State.live && State.live.priceCharting;
  let st = null;
  try { st = await (await fetch('/api/pc/sync/status', { cache: 'no-store' })).json(); } catch { }
  if (!hasToken) {
    box.innerHTML = `<p class="reason">No PriceCharting token yet.</p>
      <div class="rv-row"><button class="btn sm" id="sc-pc-key">⚙ Add token</button></div>
      <p class="reason" style="margin-top:8px">Until then: PriceCharting → Collection → Download (Excel), drop the file here or in ~/Downloads, hit <b>↻ Refresh</b> up top. Your account collection stays the source of truth either way.</p>`;
    $('#sc-pc-key').onclick = () => openSettings();
    return;
  }
  if (st && st.running) {
    const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
    box.innerHTML = `<p><b style="color:var(--accent)">Syncing…</b> ${st.done.toLocaleString()} / ${st.total.toLocaleString()} cards · ${st.updated.toLocaleString()} repriced${st.errors ? ` · <span style="color:var(--red)">${st.errors} errors</span>` : ''}</p>
      <div class="ps-prog"><div class="ps-prog-bar" style="width:${pct}%"></div></div>
      <p class="reason" style="margin-top:6px">~${st.total ? Math.ceil((st.total - st.done) * 0.13 / 60) : '?'} min left — keep the app open. Prices land in the collection file when done.</p>`;
    RV.pcPoll = setInterval(async () => {
      if (State.view !== 'scan') { clearInterval(RV.pcPoll); RV.pcPoll = null; return; }
      const s2 = await (await fetch('/api/pc/sync/status', { cache: 'no-store' })).json().catch(() => null);
      if (s2 && !s2.running) {
        clearInterval(RV.pcPoll); RV.pcPoll = null;
        toast(`PriceCharting sync done — ${s2.updated} repriced${s2.value ? ' · portfolio ' + money0(s2.value) : ''}. Reloading…`);
        await init();
        scRenderPc();
      } else scRenderPc();
    }, 2500);
    return;
  }
  const last = st && st.finishedAt
    ? `<p class="reason">Last sync ${esc(st.finishedAt.replace('T', ' '))} — ${st.updated} repriced, ${st.errors} errors${st.lastError ? ' · last error: ' + esc(String(st.lastError)) : ''}.</p>` : '';
  box.innerHTML = `<button class="btn primary" id="sc-pc-go">🔄 Sync all prices now</button> ${last}
    <p class="reason" style="margin-top:8px">Re-prices every card by its PriceCharting id (raw + graded tiers), then rebuilds totals. ~${Math.ceil((State.meta ? State.meta.totalEntries : 1300) * 0.13 / 60)} min for your collection.</p>`;
  $('#sc-pc-go').onclick = async () => {
    const r = await (await fetch('/api/pc/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    if (!r.ok) return toast(r.error || 'Could not start sync');
    scRenderPc();
  };
}

/* ============================================================
   ➕ ADD & SOLD — the ledger: add cards in-app, record sales,
   archive sold cards (kept forever, out of the collection)
   ============================================================ */
const LG = { saleCard: null };

function renderLedger() {
  const el = $('#view-ledger');
  const sold = rvSoldCards();
  const sales = sold.map(c => ({ c, s: saleGet(c) || {} }));
  const revenue = sales.reduce((a, x) => a + (+x.s.price || 0), 0);
  const netTotal = sales.reduce((a, x) => a + (x.s.net != null ? +x.s.net : (+x.s.price || 0)), 0);
  const costTotal = sales.reduce((a, x) => a + (x.c.cost || 0) * (x.c.qty || 1), 0);
  const customs = loadJSON(LS_CUSTOM, []);
  const kpi = (label, v, sub, cls) => `<div class="kpi ${cls || ''}"><div class="k-label">${label}</div><div class="k-value">${v}</div><div class="k-sub">${sub}</div></div>`;

  el.innerHTML = `
  <div class="section-head"><div><h2>➕ Add &amp; Sold</h2>
    <div class="sub">One clear place to grow the chest and close the loop: add new cards (typed or scanned), record every sale, and archive sold cards — kept forever with their photos &amp; sale data, just out of your collection totals.</div></div>
    ${sales.length ? `<button class="btn sm" id="lg-csv">⬇ Sales CSV</button>` : ''}</div>
  <div class="kpis">
    ${kpi('Realized revenue', money0(revenue), sales.length + ' sale' + (sales.length === 1 ? '' : 's') + ' recorded', 'k-gold')}
    ${kpi('Net after fees', money0(netTotal), 'what actually hit your pocket', 'k-green')}
    ${kpi('Realized profit', money0(netTotal - costTotal), 'net minus what the cards cost you', netTotal - costTotal >= 0 ? 'k-green' : '')}
    ${kpi('Added in-app', customs.length.toLocaleString(), 'cards living outside the export', 'k-blue')}
  </div>

  <div class="rv-2col">
    <div class="panel">
      <h3>➕ Add a card</h3>
      <p class="reason">For cards not in your PriceCharting export yet — pulls, trades, show pickups. They join every tab instantly and survive refreshes. Add it on PriceCharting later and it'll de-dupe on the next export.</p>
      <div class="lg-form">
        <input id="lg-name" class="s-inp" placeholder="Card name * (e.g. Charizard ex)">
        <div class="rv-row"><input id="lg-set" class="s-inp" placeholder="Set" style="flex:2"><input id="lg-num" class="s-inp" placeholder="#" style="flex:1"></div>
        <div class="rv-row">
          <select id="lg-lang" class="s-inp"><option value="en">🇺🇸 English</option><option value="ja">🇯🇵 Japanese</option></select>
          <input id="lg-price" class="s-inp" type="number" min="0" step="0.01" placeholder="Value $">
          <input id="lg-cost" class="s-inp" type="number" min="0" step="0.01" placeholder="Cost $">
          <input id="lg-qty" class="s-inp" type="number" min="1" value="1" style="width:64px" title="qty">
        </div>
        <div class="rv-row">
          <label class="rv-check"><input type="checkbox" id="lg-graded"> graded</label>
          <input id="lg-grader" class="s-inp" placeholder="Grader (PSA…)" style="display:none">
          <input id="lg-grade" class="s-inp" placeholder="Grade (10…)" style="display:none;width:90px">
        </div>
        <div class="rv-row">
          <button class="btn primary" id="lg-add">➕ Add to collection</button>
          <button class="btn gold" id="lg-addscan">📷 Add &amp; scan photo</button>
        </div>
      </div>
    </div>

    <div class="panel">
      <h3>💸 Record a sale</h3>
      <p class="reason">Pick the card, log what it really sold for — it moves to the Sold Shelf (and the Den's 💸 shelf), archives out of your totals, and keeps its photos for the record.</p>
      <input id="lg-sq" class="s-inp" style="width:100%" placeholder="Search the card you sold…">
      <div id="lg-sres" class="sc-results"></div>
      <div id="lg-sform"></div>
    </div>
  </div>

  <div class="panel" style="margin-top:14px">
    <h3>🗃 Sold Shelf <span class="reason">— archived with their sale data, forever</span></h3>
    ${sales.length ? `<div class="lg-soldgrid">${sales.map(({ c, s }) => {
      const cost = (c.cost || 0) * (c.qty || 1);
      const net = s.net != null ? +s.net : (+s.price || 0);
      return `<div class="lg-soldcard">
        <span class="lg-thumb" data-i="${c.i}">${rvThumb(c)}</span>
        <div class="lg-soldinfo">
          <b>${esc(c.name)}</b>${c.number ? ' <span class="reason">#' + esc(c.number) + '</span>' : ''}
          <div class="reason">${esc(c.set)}</div>
          <div class="lg-soldnums">${s.price != null ? `sold <b>${money(+s.price)}</b>` : 'marked sold'}${s.venue ? ' · ' + esc(s.venue) : ''}${s.date ? ' · ' + esc(s.date) : ''}</div>
          <div class="lg-soldnums">net <b style="color:var(--green)">${money(net)}</b> · profit <b style="color:${net - cost >= 0 ? 'var(--green)' : 'var(--red)'}">${money(net - cost)}</b></div>
          ${s.note ? `<div class="reason">“${esc(s.note)}”</div>` : ''}
          <div class="rv-row" style="margin-top:5px">
            ${uget(c).archived ? `<button class="minilink lg-restore" data-i="${c.i}">↩ restore to collection</button>` : `<button class="minilink lg-archive" data-i="${c.i}">🗃 archive out of totals</button>`}
            <button class="minilink lg-unsell" data-i="${c.i}">✕ undo sale</button>
          </div>
        </div></div>`;
    }).join('')}</div>` : '<p class="reason">Nothing sold yet — record your first sale above and it lands here.</p>'}
  </div>`;

  $('#lg-graded').onchange = e => {
    $('#lg-grader').style.display = e.target.checked ? '' : 'none';
    $('#lg-grade').style.display = e.target.checked ? '' : 'none';
  };
  const addCard = () => {
    const name = $('#lg-name').value.trim();
    if (!name) { toast('Give the card a name.'); return null; }
    const graded = $('#lg-graded').checked;
    const cc = {
      pcId: 'custom-' + Date.now().toString(36),
      name, set: $('#lg-set').value.trim() || 'Custom adds', number: $('#lg-num').value.trim() || null,
      lang: $('#lg-lang').value, price: +$('#lg-price').value || 0, cost: +$('#lg-cost').value || 0,
      qty: Math.max(1, +$('#lg-qty').value || 1), graded,
      grader: graded ? ($('#lg-grader').value.trim() || 'PSA') : null,
      grade: graded ? ($('#lg-grade').value.trim() || null) : null,
      dateAdded: new Date().toISOString().slice(0, 10),
    };
    const all = loadJSON(LS_CUSTOM, []); all.push(cc);
    localStorage.setItem(LS_CUSTOM, JSON.stringify(all));
    rvMergeCustom(); rvRecalcMeta();
    toast(`Added ${name} — it's in your collection now.`);
    return State.cards[State.cards.length - 1];
  };
  $('#lg-add').onclick = () => { if (addCard()) renderLedger(); };
  $('#lg-addscan').onclick = () => {
    const c = addCard();
    if (c) { RV.scan.card = c; switchView('scan'); }
  };

  /* sale flow */
  const sres = $('#lg-sres');
  $('#lg-sq').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { sres.innerHTML = ''; return; }
    const list = State.cards.filter(c => !saleGet(c) && (c.name + ' ' + c.set + ' ' + (c.number || '')).toLowerCase().includes(q)).slice(0, 6);
    sres.innerHTML = list.map(c => `<button class="sc-res" data-i="${c.i}">${rvThumb(c)}<span><b>${esc(c.name)}</b>${c.number ? ' #' + esc(c.number) : ''}<br><span class="reason">${esc(c.set)} · ask ${money(c.price)}</span></span></button>`).join('');
    $$('.sc-res', sres).forEach(b => b.onclick = () => lgSaleForm(State.cards[+b.dataset.i]));
  };
  if (LG.saleCard) lgSaleForm(LG.saleCard);

  $$('.lg-thumb', el).forEach(b => b.onclick = () => openModal(State.cards[+b.dataset.i]));
  $$('.lg-archive', el).forEach(b => b.onclick = () => { uset(State.cards[+b.dataset.i], { archived: true }); rvRecalcMeta(); renderLedger(); toast('Archived — saved forever, out of your totals.'); });
  $$('.lg-restore', el).forEach(b => b.onclick = () => { uset(State.cards[+b.dataset.i], { archived: false }); rvRecalcMeta(); renderLedger(); toast('Back in the collection.'); });
  $$('.lg-unsell', el).forEach(b => b.onclick = () => {
    const c = State.cards[+b.dataset.i];
    saleSet(c, null); uset(c, { status: '', archived: false }); rvRecalcMeta(); renderLedger();
    toast('Sale removed — card restored.');
  });
  if ($('#lg-csv')) $('#lg-csv').onclick = () => {
    const rows = [['name', 'number', 'set', 'lang', 'graded', 'grade', 'cost', 'soldPrice', 'fees', 'net', 'venue', 'date', 'note']];
    for (const { c, s } of sales) rows.push([c.name, c.number || '', c.set, c.lang, c.graded ? 'yes' : 'no', c.grade || '',
      (c.cost || 0) * (c.qty || 1), s.price ?? '', s.fees ?? '', s.net ?? '', s.venue || '', s.date || '', s.note || '']);
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'pokemon-chest-sales.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
}

function lgSaleForm(c) {
  LG.saleCard = c;
  const f = $('#lg-sform'); if (!f) return;
  const today = new Date().toISOString().slice(0, 10);
  f.innerHTML = `
    <div class="sc-sel-card" style="margin-top:10px">${rvThumb(c)}<div><b>${esc(c.name)}</b>${c.number ? ' <span class="reason">#' + esc(c.number) + '</span>' : ''}<br><span class="reason">${esc(c.set)} · was asking ${money(c.price)}</span></div></div>
    <div class="lg-form" style="margin-top:10px">
      <div class="rv-row">
        <input id="lg-sp" class="s-inp" type="number" min="0" step="0.01" placeholder="Sold for $ *">
        <input id="lg-sf" class="s-inp" type="number" min="0" step="0.01" placeholder="Fees+ship $">
        <input id="lg-sd" class="s-inp" type="date" value="${today}">
      </div>
      <div class="rv-row">
        <select id="lg-sv" class="s-inp">${['eBay', 'eBay auction', 'Whatnot', 'Facebook', 'Mercari', 'TCGplayer', 'Local / show', 'Other'].map(v => `<option>${v}</option>`).join('')}</select>
        <input id="lg-sn" class="s-inp" placeholder="Note (buyer, lot…)" style="flex:2">
      </div>
      <div class="rv-row">
        <label class="rv-check"><input type="checkbox" id="lg-sa" checked> archive out of collection totals</label>
        <button class="btn primary" id="lg-ssave">💾 Record sale</button>
      </div>
    </div>`;
  $('#lg-ssave').onclick = () => {
    const price = +$('#lg-sp').value;
    if (!price) return toast('Enter what it sold for.');
    const fees = +$('#lg-sf').value || 0;
    saleSet(c, { price, fees, net: Math.round((price - fees) * 100) / 100, venue: $('#lg-sv').value, date: $('#lg-sd').value, note: $('#lg-sn').value.trim() });
    uset(c, { status: 'sold', archived: $('#lg-sa').checked });
    LG.saleCard = null;
    rvRecalcMeta(); renderLedger();
    toast(`Sold: ${c.name} — ${money(price)}. On the Sold Shelf now.`);
  };
}
