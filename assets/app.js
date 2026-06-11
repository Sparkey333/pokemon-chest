/* ===================== Pokémon Chest ===================== */
'use strict';

const APP_VERSION = '1.0.0';
const APP_REPO = 'https://github.com/Sparkey333/pokemon-chest';

/* ---------- tiny helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const money = (n, d = 2) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const money0 = (n) => money(n, 0);
const enc = encodeURIComponent;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LS_SNAP = 'pokechest.snapshots.v1';
const LS_USER = 'pokechest.userdata.v1';
const LS_ACTIONS = 'pokechest.actions.v1';

// One-time migration from the PokéVault era — keeps existing snapshots & notes.
(function migrateLegacyKeys() {
  const map = { 'pokevault.snapshots.v1': LS_SNAP, 'pokevault.userdata.v1': LS_USER };
  for (const [oldK, newK] of Object.entries(map)) {
    try {
      if (localStorage.getItem(newK) == null) {
        const v = localStorage.getItem(oldK);
        if (v != null) localStorage.setItem(newK, v);
      }
    } catch { /* storage unavailable (private mode) — run without persistence */ }
  }
})();

const State = {
  cards: [], meta: null, intel: null,
  filtered: [], page: 0, pageSize: 60,
  view: 'dashboard',
  filters: { q: '', lang: 'all', game: 'all', era: 'all', graded: 'all', set: 'all', status: 'all', min: '', max: '' },
  sort: 'value',
  user: loadJSON(LS_USER, {}),
  sellTab: 'top',
  live: null,
};

function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } }
function saveUser() { localStorage.setItem(LS_USER, JSON.stringify(State.user)); }
function uget(c) { return State.user[c.pcId] || {}; }
function uset(c, patch) { State.user[c.pcId] = Object.assign({}, uget(c), patch); saveUser(); }

/* ---------- boot ---------- */
init();
async function init() {
  try {
    const [col, intel] = await Promise.all([
      fetch('data/collection.json?_=' + Date.now()).then(r => r.json()),
      fetch('data/selling-intel.json?_=' + Date.now()).then(r => r.json()),
    ]);
    State.cards = col.cards;
    State.meta = col.meta;
    State.intel = intel;
    recordSnapshot(col.meta.totalValue);
    State.live = await loadLiveConfig();
    updateLiveBtn();
    $('#vpValue').textContent = money0(col.meta.totalValue);
    $('#search').placeholder = `Search ${col.meta.totalEntries.toLocaleString()} cards — name, set, number…`;
    $('#footMeta').textContent =
      `Pokémon Chest v${APP_VERSION} · ${col.meta.totalEntries.toLocaleString()} entries · ${col.meta.totalCards.toLocaleString()} cards · ${col.meta.imagesMatched.toLocaleString()} with art · generated ${col.generatedAt.slice(0, 10)} from ${col.source}`;
    wireChrome();
    renderDashboard();
    renderCollection(true);
    renderSell();
    renderGuide();
  } catch (e) {
    $('#main').innerHTML = `<div class="panel" style="margin-top:30px"><h3>Couldn’t load your collection</h3>
      <p class="muted">Open this page through the <b>start.command</b> launcher (a local server), not by double-clicking index.html — browsers block data files on <code>file://</code>.</p>
      <pre style="color:var(--red);font-size:12px;white-space:pre-wrap">${esc(e.message)}</pre></div>`;
  }
}

/* ---------- price snapshots (your own price history, going forward) ---------- */
function recordSnapshot(total) {
  const snaps = loadJSON(LS_SNAP, {});
  const today = new Date().toISOString().slice(0, 10);
  snaps[today] = Math.round(total * 100) / 100;
  localStorage.setItem(LS_SNAP, JSON.stringify(snaps));
}
function snapshotSeries() {
  const snaps = loadJSON(LS_SNAP, {});
  return Object.entries(snaps).sort((a, b) => a[0] < b[0] ? -1 : 1);
}

/* ---------- chrome / routing ---------- */
function wireChrome() {
  $$('#tabs .tab').forEach(t => t.onclick = () => switchView(t.dataset.view));
  // oninput/onclick assignment (not addEventListener) keeps this idempotent —
  // init() re-runs wireChrome() after every in-app data refresh.
  $('#search').oninput = e => {
    State.filters.q = e.target.value.trim().toLowerCase();
    if (State.view !== 'collection') switchView('collection');
    syncToolbar();
    renderCollection(true);
  };
  $('#refreshBtn').onclick = refreshData;
  $('#settingsBtn').onclick = openSettings;
  document.onkeydown = e => {
    if (e.key === 'Escape') closeModal();
    if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
  };
}
function switchView(v) {
  State.view = v;
  $$('#tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- in-app data refresh ---------- */
async function refreshData() {
  if (State.live) {
    // Backend present: rebuild the database from the newest export, then reload.
    toast('Rebuilding from newest export…');
    try {
      const j = await (await fetch('/api/refresh', { method: 'POST' })).json();
      if (j.ok) {
        await init();
        const r = j.report || {};
        toast(`Rebuilt: ${(r.entries ?? 0).toLocaleString()} entries · ${(r.cards ?? 0).toLocaleString()} cards · ${money0(r.value)} · ${(r.imagesMatched ?? 0).toLocaleString()} with art`);
        return;
      }
      await init();
      toast('Refresh failed: ' + (j.error || 'unknown error'));
    } catch (e) {
      await init();
      toast('Refresh error: ' + e.message);
    }
    return;
  }
  // Static open (no backend): just re-read data & record a snapshot.
  toast('Reloading data & recording a snapshot…');
  await init();
  toast('Up to date.');
}

/* ---------- marketplace link builder ---------- */
function gradeKeyword(c) {
  if (c.graded && c.grader && c.grade) return `${c.grader} ${c.grade}`;
  return 'PSA 10';
}
function links(c) {
  const t = State.intel.urlTemplates;
  const q = enc(c.q);
  const out = [
    { t: 'PriceCharting', s: 'Your source · price history', u: c.pcUrl },
    { t: 'eBay — Sold (raw)', s: 'Real sold comps', u: t.ebayRawSold.replace('{q}', q) },
    { t: 'eBay — Sold (graded)', s: gradeKeyword(c) + ' sales', u: t.ebayGradedSold.replace('{q}', q).replace('{grade}', enc(gradeKeyword(c))) },
    { t: '130point — Sold', s: 'Free comp aggregator', u: t.onetwentypoint.replace('{q}', q) },
    c.lang === 'ja'
      ? { t: 'TCGplayer (JP)', s: 'Japanese market price', u: t.tcgplayerJp.replace('{q}', q) }
      : { t: 'TCGplayer', s: 'US market price', u: t.tcgplayerEn.replace('{q}', q) },
    { t: 'Mercari — Sold', s: 'Cheap-fee resale comps', u: t.mercariSold.replace('{q}', q) },
  ];
  return out.filter(x => x.u);
}

/* ---------- recommendation engine (uses verified thresholds) ---------- */
function gradeAdvice(c) {
  const T = State.intel.thresholds;
  if (c.graded) {
    return { verdict: 'no', title: `Already graded — ${c.grader || ''} ${c.grade || ''}`.trim(),
      body: `This slab is done. Sell graded on eBay (most liquid for slabs). A ${c.grader || 'PSA'} ${c.grade || ''} typically commands a premium over raw; check the graded comps below.` };
  }
  const p = c.price || 0;
  let threshold, mult, eraLabel;
  if (c.era === 'vintage') { threshold = T.gradeVintageRaw; mult = 6; eraLabel = 'vintage'; }
  else if (c.era === 'retro') { threshold = 50; mult = 3; eraLabel = 'older'; }
  else if (c.era === 'modern') { threshold = c.lang === 'ja' ? 55 : T.gradeModernEnglishRaw; mult = c.lang === 'ja' ? 2.2 : 2; eraLabel = 'modern'; }
  else { threshold = 60; mult = 2.5; eraLabel = ''; }

  const estPsa10 = p * mult;
  const allIn = T.allInGradingCost;
  const net = estPsa10 - p - allIn; // extra value vs leaving it raw, minus grading cost
  const jpNote = c.lang === 'ja' ? ' Japanese cards also gem-grade more often, improving your odds of a 10.' : '';

  if (p < T.gradeFloorRaw) {
    return { verdict: 'no', title: 'Not worth grading', estPsa10,
      body: `At <b>${money(p)}</b> raw it’s below the ~${money(T.gradeFloorRaw, 0)} floor where grading (~${money(allIn, 0)} all-in at CGC Bulk/TAG) can pay off. Keep raw or sell as-is.` };
  }
  if (p >= threshold && net > p * 0.5) {
    return { verdict: 'strong', title: 'Strong grading candidate', estPsa10,
      body: `${cap(eraLabel)} ${c.lang === 'ja' ? 'Japanese' : 'English'} card at <b>${money(p)}</b> raw. A clean PSA 10 ≈ <b>${money(estPsa10)}</b> (~${mult}× ${eraLabel} multiple), so roughly <b>${money(net)}</b> upside after ~${money(allIn, 0)} grading — <i>only if it grades a 10</i>. Verify centering & corners first.${jpNote}` };
  }
  if (p >= threshold * 0.7) {
    return { verdict: 'maybe', title: 'Borderline — grade only if near-mint', estPsa10,
      body: `At <b>${money(p)}</b> raw it’s near the ${eraLabel} grading threshold (~${money(threshold, 0)}). Worth it only with pack-fresh corners & 60/40+ centering; a 9 instead of a 10 often won’t beat raw + fees.${jpNote}` };
  }
  return { verdict: 'no', title: 'Probably leave it raw', estPsa10,
    body: `At <b>${money(p)}</b> raw the PSA-10 upside (~${money(estPsa10)}) is thin against ~${money(allIn, 0)} grading + selling fees for a ${eraLabel} card. Sell raw unless it’s flawless.` };
}

function sellNet(c) {
  // fee-adjusted estimate at the best venue for this card type
  const v = c.value || 0;
  const feE = 0.136, feLow = 0.11; // eBay ~13.6%, TCGplayer/Mercari ~11%
  const fee = (c.graded || c.lang === 'ja' || v > 100) ? feE : feLow;
  return { net: v * (1 - fee), feePct: Math.round(fee * 100) };
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* ---------- image helpers ---------- */
function imgHTML(c, cls) {
  if (c.img) return `<img class="${cls || ''}" loading="lazy" src="${c.img}" alt="${esc(c.name)}" onerror="this.outerHTML=phHTML(${c.i})">`;
  return phHTML(c.i);
}
function phHTML(i) {
  const c = State.cards[i];
  return `<div class="ph"><div class="pb"></div><div class="pn">${esc(c.name)}<br><span class="muted">${esc(c.set)}</span></div></div>`;
}
window.phHTML = phHTML; // referenced by inline onerror

/* ================= DASHBOARD ================= */
function renderDashboard() {
  const m = State.meta, c = State.cards;
  const graded = c.filter(x => x.graded), gradedVal = sum(graded.map(x => x.value));
  const rawVal = m.totalValue - gradedVal;
  const top = [...c].sort((a, b) => b.value - a.value).slice(0, 10);
  const imgPct = Math.round(m.imagesMatched / m.totalEntries * 100);

  const kpis = [
    { l: 'Portfolio Value', v: money0(m.totalValue), s: `${m.totalCards.toLocaleString()} cards`, cls: 'k-gold' },
    { l: 'Cost Basis', v: money0(m.totalCost), s: 'what you paid', cls: '' },
    { l: 'Unrealized P/L', v: (m.totalPL >= 0 ? '+' : '') + money0(m.totalPL), s: m.totalCost > 0 ? `${Math.round(m.totalPL / m.totalCost * 100)}% return` : '', cls: 'k-green' },
    { l: 'Unique Entries', v: m.totalEntries.toLocaleString(), s: `${m.sets.length} sets`, cls: 'k-blue' },
    { l: 'Graded Slabs', v: graded.length, s: money0(gradedVal) + ' value', cls: '' },
  ];

  $('#view-dashboard').innerHTML = `
    <div class="kpis">${kpis.map(k => `
      <div class="kpi ${k.cls}"><div class="k-label">${k.l}</div><div class="k-value">${k.v}</div><div class="k-sub">${k.s}</div></div>`).join('')}
    </div>

    ${actionBoardHTML()}

    <div class="cols side" style="margin-top:16px">
      <div class="panel">
        <h3>Portfolio value over time <span class="hint">— recorded locally each time you open / refresh</span></h3>
        ${sparkline()}
      </div>
      <div class="panel">
        <h3>English vs Japanese</h3>
        ${barRows([
          { l: '🇺🇸 English', v: m.byLang.en || 0, cls: 'en' },
          { l: '🇯🇵 Japanese', v: m.byLang.ja || 0, cls: 'jp' },
        ], m.totalValue)}
        <h3 style="margin-top:18px">Raw vs Graded</h3>
        ${barRows([
          { l: 'Raw / ungraded', v: rawVal, cls: '' },
          { l: 'Graded', v: gradedVal, cls: 'gold' },
        ], m.totalValue)}
      </div>
    </div>

    <div class="cols side" style="margin-top:16px">
      <div class="panel">
        <h3>Top sets by value</h3>
        ${m.topSets.length ? barRows(m.topSets.slice(0, 10).map(s => ({ l: s.set, v: s.value })), m.topSets[0].value) : '<p class="muted" style="font-size:13px">No sets yet — refresh after adding cards to your export.</p>'}
      </div>
      <div class="panel">
        <h3>Your 10 most valuable cards <span class="hint">— click any card</span></h3>
        <div class="minilist">${top.map(miniRow).join('')}</div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div><b>Ready to sell or grade?</b> <span class="muted">The Sell Hub ranks your cards, links live sold comps on eBay / TCGplayer / Mercari, and flags grading candidates with break-even math.</span></div>
      <button class="btn gold" onclick="switchView('sell')">Open Sell Hub →</button>
    </div>

    ${feedbackCardHTML()}`;

  $$('#view-dashboard .mini').forEach(el => el.onclick = () => openModal(State.cards[+el.dataset.i]));
  wireActionBoard();
  wireFeedback();
}

/* ---------- action board ---------- */
function actionChecks() { return loadJSON(LS_ACTIONS, {}); }
function setActionDone(id, done) {
  const a = actionChecks();
  if (done) a[id] = true; else delete a[id];
  localStorage.setItem(LS_ACTIONS, JSON.stringify(a));
}

function buildActions() {
  const c = State.cards, done = actionChecks(), items = [];
  const gradeCands = c.filter(x => !x.graded && gradeAdvice(x).verdict !== 'no').length;
  const forSale = c.filter(x => (uget(x).status || '') === 'forsale').length;
  if (gradeCands) items.push({
    id: 'grade', act: 'grade', btn: 'Open grade tab',
    title: `Review ${gradeCands.toLocaleString()} grading candidate${gradeCands === 1 ? '' : 's'}`,
    hint: 'Break-even math & live comps, ranked by upside, in the Sell Hub.',
  });
  if (forSale) items.push({
    id: 'forsale', act: 'fs', btn: 'Open for-sale list',
    title: `${forSale.toLocaleString()} card${forSale === 1 ? '' : 's'} flagged for sale — list ${forSale === 1 ? 'it' : 'them'}`,
    hint: 'Your selling worklist with net-after-fees estimates.',
  });
  if (!liveAny()) items.push({
    id: 'live', act: 'settings', btn: 'Open settings',
    title: 'Connect live data & AI',
    hint: 'Bring-your-own-key: PriceCharting, live comps, AI advisor. All optional.',
  });
  items.push({
    id: 'refresh', act: 'refresh', btn: '↻ Refresh now',
    title: 'Refresh prices after a new PriceCharting export',
    hint: State.live ? 'Rebuilds the database from your newest export — right here in the app.'
      : 'Open via start.command to rebuild in-app; otherwise re-reads current data.',
  });
  return items.slice(0, 5).map(i => ({ ...i, done: !!done[i.id] }));
}

function actionBoardHTML() {
  return `<div class="panel action-board" style="margin-top:16px">
    <h3>Action board <span class="hint">— your next moves, checked off locally</span></h3>
    <div class="actions">${buildActions().map(i => `
      <div class="action-card ${i.done ? 'done' : ''}" data-act-id="${esc(i.id)}">
        <label class="ac-check"><input type="checkbox" ${i.done ? 'checked' : ''} aria-label="Mark “${esc(i.title)}” done"></label>
        <div class="ac-text"><div class="ac-title">${esc(i.title)}</div><div class="ac-hint">${esc(i.hint)}</div></div>
        <button class="btn ghost sm ac-btn" data-do="${esc(i.act)}">${esc(i.btn)}</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function wireActionBoard() {
  $$('#view-dashboard .action-card').forEach(el => {
    const id = el.dataset.actId;
    el.querySelector('input[type=checkbox]').onchange = e => {
      setActionDone(id, e.target.checked);
      el.classList.toggle('done', e.target.checked);
    };
    el.querySelector('.ac-btn').onclick = (e) => {
      const act = e.currentTarget.dataset.do;
      if (act === 'grade') { State.sellTab = 'grade'; renderSell(); switchView('sell'); }
      else if (act === 'fs') { State.sellTab = 'fs'; renderSell(); switchView('sell'); }
      else if (act === 'settings') openSettings();
      else if (act === 'refresh') refreshData();
    };
  });
}

/* ---------- feedback card ---------- */
function diagnostics() {
  const m = State.meta || {};
  return [
    `Pokémon Chest v${APP_VERSION}`,
    `Platform: ${navigator.userAgent}`,
    `Collection: ${m.totalEntries != null ? m.totalEntries.toLocaleString() : '?'} entries · ${m.totalCards != null ? m.totalCards.toLocaleString() : '?'} cards`,
    `Live backend: ${State.live ? 'connected' : 'not running'}`,
  ].join('\n');
}
function feedbackBody() {
  return `## What happened?\n\n(describe the bug or idea here)\n\n## Diagnostics\n\`\`\`\n${diagnostics()}\n\`\`\`\n`;
}
function feedbackCardHTML() {
  return `<div class="panel feedback-card" style="margin-top:16px">
    <div><b>Found a bug? Tell me.</b> <span class="muted">Reports prefill app version, platform &amp; collection size — never your keys or files.</span></div>
    <div class="fb-btns">
      <button class="btn ghost sm" id="fbGithub">GitHub issue</button>
      <button class="btn ghost sm" id="fbEmail">Email</button>
      <button class="btn ghost sm" id="fbCopy">Copy report</button>
    </div>
  </div>`;
}
function wireFeedback() {
  const title = `[Bug] Pokémon Chest v${APP_VERSION}`;
  const gh = $('#fbGithub'), em = $('#fbEmail'), cp = $('#fbCopy');
  if (gh) gh.onclick = () => window.open(`${APP_REPO}/issues/new?title=${enc(title)}&body=${enc(feedbackBody())}`, '_blank', 'noopener');
  if (em) em.onclick = () => { location.href = `mailto:brandonlbarkey@gmail.com?subject=${enc(title)}&body=${enc(feedbackBody())}`; };
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(feedbackBody()); toast('Report copied to clipboard.'); }
    catch { toast('Couldn’t copy automatically — use the GitHub issue button instead.'); }
  };
}

function miniRow(c) {
  const pl = uget(c).status;
  return `<div class="mini" data-i="${c.i}">
    ${c.img ? `<img class="thumb" loading="lazy" src="${c.img}" onerror="this.outerHTML=phThumb(${c.i})">` : phThumb(c.i)}
    <div class="mtext"><div class="mname">${esc(c.name)} ${c.graded ? `<span class="grade-chip" style="font-size:9px">${esc(c.grader || '')} ${c.grade || ''}</span>` : ''}</div>
      <div class="mset">${esc(c.set)} · ${c.lang === 'ja' ? 'JP' : 'EN'}${c.number ? ' · #' + esc(c.number) : ''}</div></div>
    <div class="mval">${money(c.price)}</div>
  </div>`;
}
window.phThumb = (i) => `<div class="ph thumb" style="width:38px;height:53px"><div class="pb" style="width:20px;height:20px"></div></div>`;

function barRows(rows, maxBase) {
  const max = Math.max(maxBase || 1, ...rows.map(r => r.v));
  return `<div class="bars">${rows.map(r => `
    <div class="bar-row"><div class="bl" title="${esc(r.l)}">${esc(r.l)}</div>
      <div class="bar-track"><div class="bar-fill ${r.cls || ''}" style="width:${Math.max(2, r.v / max * 100)}%"></div></div>
      <div class="bv">${money0(r.v)}</div></div>`).join('')}</div>`;
}

function sparkline() {
  const data = snapshotSeries();
  if (data.length < 2) {
    return `<div class="spark-empty">Tracking started today (${money(data[0] ? data[0][1] : State.meta.totalValue)}).<br>Open or refresh Pokémon Chest on future days to build your value history.</div>`;
  }
  const vals = data.map(d => d[1]);
  const min = Math.min(...vals), max = Math.max(...vals), W = 600, H = 110, pad = 8;
  const x = i => pad + i * (W - 2 * pad) / (data.length - 1);
  const y = v => H - pad - (max === min ? 0.5 : (v - min) / (max - min)) * (H - 2 * pad);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d[1]).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
  const last = data[data.length - 1], first = data[0];
  const chg = last[1] - first[1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#4cc2ff" stop-opacity=".35"/><stop offset="1" stop-color="#4cc2ff" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${area}" fill="url(#sg)"/>
    <polyline points="${pts}" fill="none" stroke="#4cc2ff" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${x(data.length - 1)}" cy="${y(last[1])}" r="3.5" fill="#ffce4d"/>
  </svg>
  <div class="muted" style="font-size:12px;margin-top:6px">${data.length} day(s) tracked · ${money(first[1])} → ${money(last[1])}
    <b style="color:${chg >= 0 ? 'var(--green)' : 'var(--red)'}">(${chg >= 0 ? '+' : ''}${money(chg)})</b></div>`;
}

/* ================= COLLECTION ================= */
function buildToolbar() {
  const sets = ['all', ...State.meta.sets];
  const games = ['all', ...Object.keys(State.meta.byGame)];
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label ?? v)}</option>`;
  $('#collectionToolbar').innerHTML = `
    <select id="f-sort">
      ${['value:Value (high→low)','price:Price (high→low)','pl:Profit $ (high→low)','plPct:Return % (high→low)','name:Name (A→Z)','new:Newest added','old:Oldest added'].map(o => {
        const [v, l] = o.split(':'); return opt(v, State.sort, l);
      }).join('')}
    </select>
    <select id="f-lang">${[['all','All langs'],['en','🇺🇸 English'],['ja','🇯🇵 Japanese']].map(([v,l]) => opt(v, State.filters.lang, l)).join('')}</select>
    <select id="f-graded">${[['all','Raw + Graded'],['raw','Raw only'],['graded','Graded only']].map(([v,l]) => opt(v, State.filters.graded, l)).join('')}</select>
    <select id="f-era">${[['all','All eras'],['modern','Modern (2020+)'],['retro','2011–2019'],['vintage','Vintage (≤2010)']].map(([v,l]) => opt(v, State.filters.era, l)).join('')}</select>
    <select id="f-set">${sets.map(s => opt(s, State.filters.set, s === 'all' ? 'All sets' : s)).join('')}</select>
    <select id="f-status">${[['all','Any status'],['forsale','For sale'],['sold','Sold'],['unmarked','Unmarked']].map(([v,l]) => opt(v, State.filters.status, l)).join('')}</select>
    ${games.length > 2 ? `<select id="f-game">${games.map(g => opt(g, State.filters.game, g === 'all' ? 'All games' : g)).join('')}</select>` : ''}
    <span class="tlabel">$</span>
    <input id="f-min" type="number" min="0" placeholder="min" value="${State.filters.min}" style="width:74px">
    <input id="f-max" type="number" min="0" placeholder="max" value="${State.filters.max}" style="width:74px">
    <button class="btn ghost sm" id="f-clear">Clear</button>
    <span class="spacer"></span>
    <span class="count-pill" id="countPill">—</span>`;

  const bind = (id, key) => $('#' + id).onchange = e => { State.filters[key] = e.target.value; renderCollection(true); };
  $('#f-sort').onchange = e => { State.sort = e.target.value; renderCollection(true); };
  bind('f-lang', 'lang'); bind('f-graded', 'graded'); bind('f-era', 'era');
  bind('f-set', 'set'); bind('f-status', 'status');
  if ($('#f-game')) bind('f-game', 'game');
  $('#f-min').oninput = e => { State.filters.min = e.target.value; renderCollection(true); };
  $('#f-max').oninput = e => { State.filters.max = e.target.value; renderCollection(true); };
  $('#f-clear').onclick = () => {
    State.filters = { q: State.filters.q, lang: 'all', game: 'all', era: 'all', graded: 'all', set: 'all', status: 'all', min: '', max: '' };
    State.sort = 'value'; buildToolbar(); renderCollection(true);
  };
}
function syncToolbar() { const el = $('#f-min'); if (!el) buildToolbar(); }

function applyFilters() {
  const f = State.filters;
  const min = f.min === '' ? -Infinity : +f.min, max = f.max === '' ? Infinity : +f.max;
  let arr = State.cards.filter(c => {
    if (f.q) {
      const hay = (c.name + ' ' + c.set + ' ' + (c.number || '') + ' ' + c.setRaw).toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (f.lang !== 'all' && c.lang !== f.lang) return false;
    if (f.graded === 'raw' && c.graded) return false;
    if (f.graded === 'graded' && !c.graded) return false;
    if (f.era !== 'all' && c.era !== f.era) return false;
    if (f.set !== 'all' && c.set !== f.set) return false;
    if (f.game !== 'all' && c.game !== f.game) return false;
    const st = uget(c).status || '';
    if (f.status === 'forsale' && st !== 'forsale') return false;
    if (f.status === 'sold' && st !== 'sold') return false;
    if (f.status === 'unmarked' && st) return false;
    const p = c.price || 0;
    if (p < min || p > max) return false;
    return true;
  });
  const s = State.sort;
  const cmp = {
    value: (a, b) => b.value - a.value,
    price: (a, b) => (b.price || 0) - (a.price || 0),
    pl: (a, b) => (b.pl || 0) - (a.pl || 0),
    plPct: (a, b) => (b.plPct || -1e9) - (a.plPct || -1e9),
    name: (a, b) => a.name.localeCompare(b.name),
    new: (a, b) => (b.dateAdded || '').localeCompare(a.dateAdded || ''),
    old: (a, b) => (a.dateAdded || '').localeCompare(b.dateAdded || ''),
  }[s] || ((a, b) => b.value - a.value);
  arr.sort(cmp);
  State.filtered = arr;
}

function renderCollection(reset) {
  if (!$('#f-sort')) buildToolbar();
  if (reset) { applyFilters(); State.page = 0; $('#grid').innerHTML = ''; }
  const { filtered } = State;
  $('#countPill').textContent = `${filtered.length.toLocaleString()} cards · ${money0(sum(filtered.map(c => c.value)))}`;
  $('#gridEmpty').hidden = filtered.length > 0;
  const start = State.page * State.pageSize, slice = filtered.slice(start, start + State.pageSize);
  const html = slice.map(cardHTML).join('');
  $('#grid').insertAdjacentHTML('beforeend', html);
  $$('#grid .card:not([data-wired])').forEach(el => { el.dataset.wired = '1'; el.onclick = () => openModal(State.cards[+el.dataset.i]); });
  State.page++;
  setupSentinel();
}
let _io;
function setupSentinel() {
  if (_io) _io.disconnect();
  if (State.page * State.pageSize >= State.filtered.length) return;
  _io = new IntersectionObserver(es => { if (es[0].isIntersecting) renderCollection(false); }, { rootMargin: '600px' });
  _io.observe($('#gridSentinel'));
}

function cardHTML(c) {
  const u = uget(c), pl = c.pl;
  const plBadge = pl == null ? '' : `<span class="pl-badge ${pl >= 0 ? 'pl-up' : 'pl-down'}">${pl >= 0 ? '▲' : '▼'} ${money(Math.abs(pl), pl >= 100 || pl <= -100 ? 0 : 2)}</span>`;
  const status = u.status === 'sold' ? '<span class="tag-sold">Sold</span>' : u.status === 'forsale' ? '<span class="tag-fs">For sale</span>' : '';
  return `<div class="card" data-i="${c.i}">
    <div class="card-img">
      ${imgHTML(c, '')}
      <div class="card-badges">
        <span class="flag ${c.lang}">${c.lang === 'ja' ? 'JP' : 'EN'}</span>
        ${c.graded ? `<span class="grade-chip">${esc(c.grader || 'GRD')} ${c.grade || ''}</span>` : ''}
      </div>
      ${status}
    </div>
    <div class="card-body">
      <div class="card-name" title="${esc(c.fullName)}">${esc(c.name)}</div>
      <div class="card-set">${esc(c.set)}${c.number ? ' · #' + esc(c.number) : ''}</div>
      <div class="card-foot"><span class="card-price">${money(c.price)}</span>${plBadge}</div>
    </div>
  </div>`;
}

/* ================= SELL HUB ================= */
function renderSell() {
  const c = State.cards;
  const gradeCands = c.filter(x => !x.graded && gradeAdvice(x).verdict !== 'no')
    .map(x => ({ x, a: gradeAdvice(x) }))
    .sort((p, q) => (q.a.estPsa10 - q.x.price) - (p.a.estPsa10 - p.x.price));
  const top = [...c].sort((a, b) => b.value - a.value).slice(0, 40);
  const forSale = c.filter(x => (uget(x).status || '') === 'forsale').sort((a, b) => b.value - a.value);

  const tabs = [
    ['top', `Top sellers (${top.length})`],
    ['grade', `Grading candidates (${gradeCands.length})`],
    ['fs', `My for-sale list (${forSale.length})`],
  ];
  let body = '';
  if (State.sellTab === 'top') body = sellTable(top.map(x => ({ x })), 'top');
  else if (State.sellTab === 'grade') body = sellTable(gradeCands, 'grade');
  else body = forSale.length ? sellTable(forSale.map(x => ({ x })), 'fs')
    : `<div class="empty">No cards flagged yet. Open any card and hit <b>Mark “For sale”</b> to build your selling worklist here.</div>`;

  $('#view-sell').innerHTML = `
    <div class="section-head"><h2>Sell Hub</h2>
      <span class="sub">Live sold comps + grading math. Fees baked into “net est.” (eBay ~13.6% / low-fee venues ~11%).</span></div>
    <div class="tabbar">${tabs.map(([v, l]) => `<button class="${State.sellTab === v ? 'active' : ''}" data-st="${v}">${l}</button>`).join('')}</div>
    ${body}`;

  $$('#view-sell .tabbar button').forEach(b => b.onclick = () => { State.sellTab = b.dataset.st; renderSell(); });
  $$('#view-sell .sr-card, #view-sell .open-i').forEach(el => el.onclick = () => openModal(State.cards[+el.dataset.i]));
}

function sellTable(rows, mode) {
  const head = mode === 'grade'
    ? `<th>Card</th><th>Raw value</th><th>Est. PSA 10</th><th>Verdict</th><th>Comps</th>`
    : `<th>Card</th><th>Value</th><th>Net est.</th><th>P/L</th><th>Comps</th>`;
  return `<table class="sell-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(r => sellRow(r, mode)).join('')}</tbody></table>`;
}
function sellRow(r, mode) {
  const c = r.x, L = links(c);
  const pick = (name) => { const f = L.find(l => l.t.startsWith(name)); return f ? f.u : '#'; };
  const compCells = `<div class="sr-links">
      <a class="minilink" href="${pick('eBay — Sold (raw)')}" target="_blank" rel="noopener">eBay raw</a>
      <a class="minilink" href="${pick('eBay — Sold (graded)')}" target="_blank" rel="noopener">eBay graded</a>
      <a class="minilink" href="${pick(c.lang === 'ja' ? 'TCGplayer (JP)' : 'TCGplayer')}" target="_blank" rel="noopener">TCGplayer</a>
      <a class="minilink" href="${c.pcUrl || '#'}" target="_blank" rel="noopener">PriceCharting</a>
    </div>`;
  const cardCell = `<div class="sr-card" data-i="${c.i}">
      ${c.img ? `<img loading="lazy" src="${c.img}" onerror="this.outerHTML=phThumb(${c.i})">` : phThumb(c.i)}
      <div><div class="sr-name">${esc(c.name)} ${c.graded ? `<span class="grade-chip" style="font-size:9px">${esc(c.grader || '')} ${c.grade || ''}</span>` : ''}</div>
        <div class="sr-set">${esc(c.set)} · ${c.lang === 'ja' ? 'JP' : 'EN'}${c.number ? ' · #' + esc(c.number) : ''}</div></div>
    </div>`;
  if (mode === 'grade') {
    const a = r.a, vClass = a.verdict === 'strong' ? 'var(--green)' : 'var(--gold)';
    return `<tr class="sell-row"><td>${cardCell}</td>
      <td class="sr-val" style="color:var(--text)">${money(c.price)}</td>
      <td class="sr-val">${money(a.estPsa10)}</td>
      <td><span class="reason" style="color:${vClass};font-weight:700">${a.verdict === 'strong' ? '★ Strong' : 'Maybe'}</span><br><span class="reason">+${money(a.estPsa10 - c.price - State.intel.thresholds.allInGradingCost)} upside</span></td>
      <td>${compCells}</td></tr>`;
  }
  const s = sellNet(c), pl = c.pl;
  return `<tr class="sell-row"><td>${cardCell}</td>
    <td class="sr-val">${money(c.value)}</td>
    <td class="sr-val" style="color:var(--green)">${money(s.net)} <span class="reason">(−${s.feePct}%)</span></td>
    <td>${pl == null ? '—' : `<span class="reason" style="color:${pl >= 0 ? 'var(--green)' : 'var(--red)'}">${pl >= 0 ? '+' : ''}${money(pl)}</span>`}</td>
    <td>${compCells}</td></tr>`;
}

/* ================= GUIDE ================= */
function renderGuide() {
  const I = State.intel;
  $('#view-guide').innerHTML = `
    <div class="section-head"><h2>Sell &amp; Grade Guide</h2><span class="sub">${esc(I.disclaimer)}</span></div>
    <div class="callout"><b>Break-even rule of thumb.</b> ${esc(I.breakEven)}</div>

    <div class="guide-grid" style="margin-top:16px">
      <div class="panel"><h3>When to grade — green flags</h3><ul class="bullets">${I.gradeCandidateSignals.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="panel"><h3>When NOT to grade</h3><ul class="bullets">${I.doNotGrade.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
    </div>

    <div class="panel" style="margin-top:16px"><h3>Grade-value multiples</h3>
      <p class="muted" style="font-size:13px;line-height:1.6"><b style="color:var(--gold)">Vintage:</b> ${esc(I.gradeMultiples.vintage)}</p>
      <p class="muted" style="font-size:13px;line-height:1.6"><b style="color:var(--gold)">Modern:</b> ${esc(I.gradeMultiples.modern)}</p>
      <p class="muted" style="font-size:13px;line-height:1.6"><b style="color:var(--gold)">Key:</b> ${esc(I.gradeMultiples.note)}</p>
    </div>

    <div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Cheapest grading tiers (Jun 2026)</h3>
        <table class="guide-table"><thead><tr><th>Grader</th><th>Tier</th><th>≤ Value</th><th>Cost</th><th>Turnaround</th></tr></thead>
        <tbody>${I.gradingTiers.map(t => `<tr><td><b>${esc(t.grader)}</b></td><td>${esc(t.tier)}</td><td>${esc(t.maxValue)}</td><td>${esc(t.cost)}</td><td class="muted">${esc(t.turnaround)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="panel"><h3>Where to sell — fees &amp; fit</h3>
        <table class="guide-table"><thead><tr><th>Marketplace</th><th>Seller fee</th></tr></thead>
        <tbody>${I.marketplaces.map(mk => `<tr><td><b>${esc(mk.name)}</b><br><span class="reason">${esc(mk.bestFor)}</span></td><td style="white-space:nowrap">${esc(mk.fee)}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>

    <div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Best venues by card type</h3>
        ${['rawEnglish:Raw English','gradedEnglish:Graded English','japanese:Japanese'].map(o => {
          const [k, l] = o.split(':'); return `<div class="subhead">${l}</div><ul class="bullets">${I.bestVenues[k].map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
        }).join('')}
      </div>
      <div class="panel"><h3>Sources</h3>
        <div class="src-list">${I.sources.map(s => `<div><a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></div>`).join('')}</div>
      </div>
    </div>`;
}

/* ================= MODAL ================= */
function openModal(c) {
  const u = uget(c), a = gradeAdvice(c), L = links(c), s = sellNet(c);
  const statBox = (l, v, color) => `<div class="stat"><div class="s-l">${l}</div><div class="s-v" style="${color ? 'color:' + color : ''}">${v}</div></div>`;
  const plColor = c.pl == null ? '' : (c.pl >= 0 ? 'var(--green)' : 'var(--red)');
  const html = `<div class="modal-bg" id="modalBg"><div class="modal">
    <button class="close-x" id="modalClose">×</button>
    <div class="modal-top">
      <div class="modal-imgwrap">${c.img ? `<img src="${c.img}" alt="${esc(c.name)}" onerror="this.outerHTML=phHTML(${c.i})">` : phHTML(c.i)}</div>
      <div class="modal-info">
        <div class="mi-set">${esc(c.set)}${c.number ? ' · #' + esc(c.number) : ''}</div>
        <h2>${esc(c.name)}</h2>
        <div class="mi-meta">
          <span class="chip ${c.lang}">${c.lang === 'ja' ? '🇯🇵 Japanese' : '🇺🇸 English'}</span>
          ${c.graded ? `<span class="chip gold">${esc(c.grader || 'Graded')} ${c.grade || ''}</span>` : `<span class="chip">Raw · ${esc(c.condition)}</span>`}
          ${c.setYear ? `<span class="chip">${c.setYear} · ${esc(c.era)}</span>` : ''}
          ${c.qty > 1 ? `<span class="chip">×${c.qty}</span>` : ''}
        </div>
        <div class="stat-grid">
          ${statBox('Market', money(c.price), 'var(--gold)')}
          ${statBox('Cost', money(c.cost))}
          ${statBox('P/L', c.pl == null ? '—' : (c.pl >= 0 ? '+' : '') + money(c.pl), plColor)}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn ${u.status === 'forsale' ? 'gold' : ''} sm" id="mk-fs">${u.status === 'forsale' ? '✓ For sale' : 'Mark “For sale”'}</button>
          <button class="btn ${u.status === 'sold' ? 'primary' : ''} sm" id="mk-sold">${u.status === 'sold' ? '✓ Sold' : 'Mark “Sold”'}</button>
          ${u.status ? `<button class="btn ghost sm" id="mk-clear">Clear</button>` : ''}
        </div>
      </div>
    </div>
    <div class="modal-body">
      <div class="rec-box ${a.verdict}">
        <div class="rh">${a.verdict === 'strong' ? '★' : a.verdict === 'maybe' ? '◐' : '○'} ${esc(a.title)}</div>
        <div class="rb">${a.body}</div>
      </div>

      <div class="subhead">Check live prices &amp; sold comps</div>
      <div class="linkgrid">
        ${L.map(l => `<a class="linkbtn" href="${l.u}" target="_blank" rel="noopener"><span class="lb-t">${esc(l.t)} ↗</span><span class="lb-s">${esc(l.s)}</span></a>`).join('')}
      </div>

      <div class="subhead">Sell math</div>
      <div class="rb muted" style="font-size:13px">At <b style="color:var(--gold)">${money(c.value)}</b>${c.qty > 1 ? ` (×${c.qty})` : ''}, a sale nets ≈ <b style="color:var(--green)">${money(s.net)}</b> after ~${s.feePct}% fees on ${c.graded || c.lang === 'ja' || c.value > 100 ? 'eBay' : 'a low-fee venue'}. ${c.datePurchased ? `Bought ${c.datePurchased}.` : ''} Added ${c.dateAdded || '—'}.</div>

      ${liveZoneHTML(c)}

      <div class="subhead">Private note</div>
      <div class="note-row"><textarea id="mk-note" placeholder="Condition notes, asking price, where it's listed…">${esc(u.note || '')}</textarea></div>
    </div>
  </div></div>`;
  $('#modalRoot').innerHTML = html;
  wireLiveZone(c);
  $('#modalClose').onclick = closeModal;
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
  $('#mk-fs').onclick = () => { uset(c, { status: uget(c).status === 'forsale' ? '' : 'forsale' }); openModal(c); refreshAfterUser(); };
  $('#mk-sold').onclick = () => { uset(c, { status: uget(c).status === 'sold' ? '' : 'sold' }); openModal(c); refreshAfterUser(); };
  if ($('#mk-clear')) $('#mk-clear').onclick = () => { uset(c, { status: '' }); openModal(c); refreshAfterUser(); };
  $('#mk-note').onchange = e => uset(c, { note: e.target.value });
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
function refreshAfterUser() { if (State.view === 'collection') renderCollection(true); if (State.view === 'sell') renderSell(); }

/* ================= LIVE (BYOK backend) ================= */
async function loadLiveConfig() {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return ('priceCharting' in j) ? j : null; // sanity: it's the backend, not a static 404 page
  } catch { return null; }
}
function liveAny() { const L = State.live; return L && (L.priceCharting || L.comps?.enabled || L.ai?.enabled); }
function updateLiveBtn() {
  const b = $('#settingsBtn'); if (!b) return;
  if (!State.live) { b.textContent = '⚙ Live'; b.title = 'Run via start.command to enable live data & AI'; return; }
  b.classList.toggle('gold', liveAny());
  b.textContent = liveAny() ? '⚡ Live' : '⚙ Connect live';
}

function openSettings() {
  const L = State.live;
  if (!L) {
    toast('Open Pokémon Chest via start.command to connect live data.');
  }
  const v = (id) => document.getElementById(id)?.value?.trim() || '';
  const enabled = (b) => b ? '<span class="chip gold">connected</span>' : '<span class="chip">not set</span>';
  const html = `<div class="modal-bg" id="modalBg"><div class="modal" style="max-width:640px">
    <button class="close-x" id="modalClose">×</button>
    <div class="modal-body" style="padding:26px">
      <h2 style="font-size:20px;margin-bottom:4px">⚡ Connect live data &amp; AI</h2>
      <p class="muted" style="font-size:13px;margin-bottom:6px">All optional and bring-your-own-key. Keys are stored locally in <code>settings.local.json</code> (gitignored) and sent only to that provider — never bundled, never shared. With nothing set, Pokémon Chest runs on your export + free TCGdex images + deep-links.</p>
      ${!L ? `<div class="rec-box no" style="margin:10px 0"><div class="rb">⚠️ The live backend isn’t running. Launch Pokémon Chest with <b>start.command</b> (not by opening index.html) to save keys.</div></div>` : ''}

      <div class="subhead">PriceCharting API — accurate prices (ungraded + graded) ${L ? enabled(L.priceCharting) : ''}</div>
      <input id="s-pc" class="s-inp" type="password" placeholder="40-char API token from your PriceCharting subscription" />
      <p class="muted" style="font-size:11.5px">Find it on PriceCharting → Subscription → API/Download. Updates values by each card’s exact id.</p>

      <div class="subhead">Comps API — live eBay-sold + TCGplayer + images</div>
      <select id="s-comps-provider" class="s-inp">
        <option value="pokemonpricetracker">PokemonPriceTracker (~$10/mo)</option>
        <option value="pokemon-api">Pokemon-API.com</option>
      </select>
      <input id="s-comps" class="s-inp" type="password" placeholder="Comps API key ${L && L.comps?.enabled ? '(connected — leave blank to keep)' : ''}" />

      <div class="subhead">AI recommendation engine</div>
      <select id="s-ai-provider" class="s-inp">
        <option value="anthropic">Claude (Anthropic) — recommended</option>
        <option value="openai">OpenAI</option>
      </select>
      <input id="s-ai-model" class="s-inp" type="text" placeholder="Model (default claude-fable-5 / gpt-4o)" />
      <input id="s-ai" class="s-inp" type="password" placeholder="AI API key ${L && L.ai?.enabled ? '(connected — leave blank to keep)' : ''}" />

      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn primary" id="s-save">Save &amp; connect</button>
        <button class="btn ghost" id="s-cancel">Close</button>
      </div>
      <div id="s-status" class="muted" style="font-size:12.5px;margin-top:10px"></div>
    </div></div></div>`;
  $('#modalRoot').innerHTML = html;
  if (L) {
    if (L.comps?.provider) $('#s-comps-provider').value = L.comps.provider;
    if (L.ai?.provider) $('#s-ai-provider').value = L.ai.provider;
  }
  $('#modalClose').onclick = closeModal; $('#s-cancel').onclick = closeModal;
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
  $('#s-save').onclick = async () => {
    const patch = {
      pricecharting_token: v('s-pc'),
      comps_provider: $('#s-comps-provider').value, comps_key: v('s-comps'),
      ai_provider: $('#s-ai-provider').value, ai_model: v('s-ai-model'), ai_key: v('s-ai'),
    };
    // don't wipe an existing key when the field is left blank
    if (!patch.pricecharting_token) delete patch.pricecharting_token;
    if (!patch.comps_key) delete patch.comps_key;
    if (!patch.ai_key) delete patch.ai_key;
    $('#s-status').textContent = 'Saving…';
    try {
      const r = await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      State.live = await r.json();
      updateLiveBtn();
      $('#s-status').innerHTML = `✓ Saved. ${liveAny() ? 'Live features are on — open any card.' : 'Nothing connected yet.'}`;
      toast('Settings saved.');
    } catch (e) { $('#s-status').textContent = 'Could not save: ' + e.message; }
  };
}

function liveZoneHTML(c) {
  if (!State.live) return '';
  const L = State.live;
  const btns = [];
  if (L.priceCharting && c.pcId) btns.push(`<button class="btn sm" id="live-price">↻ Live price (PriceCharting)</button>`);
  if (L.comps?.enabled) btns.push(`<button class="btn sm" id="live-comps">📊 Live sold comps</button>`);
  if (L.ai?.enabled) btns.push(`<button class="btn sm gold" id="live-ai">⚡ Ask AI: sell or grade?</button>`);
  if (!btns.length) return `<div class="subhead">Live</div><div class="rb muted" style="font-size:12.5px">Connect a key in <b>⚙ Live</b> to pull live values and an AI recommendation here.</div>`;
  return `<div class="subhead">Live data &amp; AI</div><div style="display:flex;gap:8px;flex-wrap:wrap">${btns.join('')}</div><div id="live-out" class="rb muted" style="font-size:13px;margin-top:10px"></div>`;
}
function wireLiveZone(c) {
  const out = $('#live-out'); if (!out && !$('#live-price')) return;
  const busy = (m) => { if (out) out.innerHTML = `<span class="muted">${m}</span>`; };
  if ($('#live-price')) $('#live-price').onclick = async () => {
    busy('Fetching PriceCharting values…');
    try {
      const j = await (await fetch('/api/price?id=' + enc(c.pcId))).json();
      if (j.enabled === false) return busy('Add your PriceCharting token in ⚙ Live.');
      if (!j.ok) return busy('PriceCharting: ' + esc(j.error || 'no data'));
      const t = j.tiers || {};
      const rows = Object.entries(t).map(([k, val]) => `<b>${esc(k)}</b> ${money(val)}`).join(' · ');
      out.innerHTML = `<b style="color:var(--gold)">Live PriceCharting:</b> ${rows || '—'}`;
    } catch (e) { busy('Error: ' + esc(e.message)); }
  };
  if ($('#live-comps')) $('#live-comps').onclick = async () => {
    busy('Pulling live sold comps…');
    try {
      const j = await (await fetch('/api/comps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: c.q, lang: c.lang, grade: gradeKeyword(c) }) })).json();
      if (j.enabled === false) return busy('Add a comps API key in ⚙ Live.');
      if (!j.ok) return busy('Comps: ' + esc(j.error || 'no data'));
      out.innerHTML = `<b style="color:var(--accent)">Live comps (${esc(j.provider)}):</b> <pre style="white-space:pre-wrap;font-size:11.5px;color:var(--muted)">${esc(JSON.stringify(j.raw, null, 2).slice(0, 1200))}</pre>`;
    } catch (e) { busy('Error: ' + esc(e.message)); }
  };
  if ($('#live-ai')) $('#live-ai').onclick = async () => {
    busy('Asking the AI advisor…');
    const a = gradeAdvice(c), s = sellNet(c);
    const ctx = { name: c.fullName, set: c.set, number: c.number, language: c.lang, era: c.era, year: c.setYear,
      graded: c.graded, grader: c.grader, grade: c.grade, marketValue: c.price, cost: c.cost, qty: c.qty,
      ourGradeRead: a.title, estPsa10: a.estPsa10, netAfterFees: s.net };
    try {
      const j = await (await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ctx) })).json();
      if (j.enabled === false) return busy('Add a Claude or OpenAI key in ⚙ Live.');
      if (!j.ok) return busy('AI: ' + esc(j.error || 'no response'));
      out.innerHTML = `<div class="rec-box maybe" style="margin:4px 0"><div class="rh">⚡ AI advisor <span class="muted" style="font-weight:500">(${esc(j.model)})</span></div><div class="rb">${esc(j.text).replace(/\n/g, '<br>')}</div></div>`;
    } catch (e) { busy('Error: ' + esc(e.message)); }
  };
}

/* ---------- utils ---------- */
function sum(a) { return a.reduce((x, y) => x + (y || 0), 0); }
function toast(msg) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}
window.switchView = switchView;
