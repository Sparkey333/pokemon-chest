/* ===================== Pokémon Chest ===================== */
'use strict';

const APP_VERSION = '1.7.0';
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
const LS_POP = 'pokechest.pop.v1';
const LS_MERCH = 'pokechest.merch.v1';
const LS_CASE = 'pokechest.case.v1';          // display-case picks: {pcId:{tier,note,added}}
const LS_CARDSNAP = 'pokechest.cardsnaps.v1'; // per-card price history for case cards

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
    const grab = (u) => fetch(u + '?_=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    const [col, intel, gintel, merch, lab, submit, sellerbiz, plan, venues] = await Promise.all([
      fetch('data/collection.json?_=' + Date.now()).then(r => r.json()),
      fetch('data/selling-intel.json?_=' + Date.now()).then(r => r.json()),
      grab('data/grade-intel.json'),   // grade ratios / pop intel (research-verified)
      grab('data/merch-guide.json'),   // merch categories & sealed rules
      grab('data/grade-lab.json'),     // PSA process replica + rig specs (research-verified)
      grab('data/submit-guide.json'),  // submission walkthrough + turnaround status
      grab('data/seller-biz.json'),    // FB Marketplace setup + LLC/business playbook
      grab('data/game-plan.json'),     // LLC concept + invest picks + big ideas (research-verified)
      grab('data/local-venues.json'),  // Colorado Springs local venues + automation/photo guidance
    ]);
    State.cards = col.cards;
    State.meta = col.meta;
    State.intel = intel;
    State.gintel = gintel;
    State.merch = merch;
    State.lab = lab;
    State.submit = submit;
    State.sellerbiz = sellerbiz;
    State.plan = plan;
    State.venues = venues;
    recordSnapshot(col.meta.totalValue);
    recordCardSnaps();
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
    renderMerch();
    renderLab();
    renderSubmit();
    renderAdmin();
    renderCase();
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
    { t: 'FB Marketplace', s: 'Local asking prices · 0% fees', u: 'https://www.facebook.com/marketplace/search?query=' + q },
  ];
  return out.filter(x => x.u);
}

/* ---------- grade ladder (PSA 10/9/8 + other services, research-verified ratios) ---------- */
// Fallbacks only matter until data/grade-intel.json ships; that file (built from
// verified research) overrides everything here at runtime.
const GRADE_FALLBACK = {
  gradeRatios: {
    vintage: { psa9OfPsa10: 0.45, psa8OfPsa10: 0.22, psa10OfRaw: 6 },
    mid:     { psa9OfPsa10: 0.45, psa8OfPsa10: 0.20, psa10OfRaw: 3 },
    modern:  { psa9OfPsa10: 0.40, psa8OfPsa10: 0.15, psa10OfRaw: 2 },
    japaneseNote: 'Japanese cards gem-grade more often; ratios hold roughly the same. (est.)',
  },
  serviceDeltas: [
    { service: 'CGC', vsPsaPct: 75, note: 'CGC usually sells at a discount to PSA at equal grade. (est.)' },
    { service: 'TAG', vsPsaPct: 70, note: 'Newer service; thinner market than PSA. (est.)' },
  ],
};
function gradeIntel() { return State.gintel || GRADE_FALLBACK; }
function eraKey(c) { return c.era === 'vintage' ? 'vintage' : c.era === 'retro' ? 'mid' : 'modern'; }
function gradeLadder(c) {
  const gi = gradeIntel();
  let r = gi.gradeRatios[eraKey(c)] || gi.gradeRatios.modern;
  // Japanese modern cards have a compressed grade curve (higher gem rates →
  // raw already prices in the 10): use the dedicated ratio set when present.
  if (c.lang === 'ja' && eraKey(c) === 'modern' && gi.gradeRatios.modernJa) r = gi.gradeRatios.modernJa;
  const raw = c.price || 0;
  const psa10 = raw * r.psa10OfRaw;
  const services = {};
  for (const s of gi.serviceDeltas || []) services[s.service] = { v: psa10 * (s.vsPsaPct / 100), note: s.note };
  return {
    raw,
    psa10, psa9: psa10 * r.psa9OfPsa10, psa8: psa10 * r.psa8OfPsa10,
    services,
    ratios: r,
  };
}
function gradeSoldLink(c, keyword) {
  const t = State.intel.urlTemplates;
  return t.ebayGradedSold.replace('{q}', enc(c.q)).replace('{grade}', enc(keyword));
}
/* per-card pop-watch records (manual entry; BYOK auto-fill later) */
function popGet(c) { return loadJSON(LS_POP, {})[c.pcId] || null; }
function popSet(c, pop) {
  const all = loadJSON(LS_POP, {});
  if (pop == null || pop === '') delete all[c.pcId];
  else all[c.pcId] = { pop: +pop, date: new Date().toISOString().slice(0, 10) };
  localStorage.setItem(LS_POP, JSON.stringify(all));
}
function popTier(pop) {
  const tiers = (State.gintel && State.gintel.popIntel && State.gintel.popIntel.tiers) || [
    { label: 'Low pop', maxPop: 100, advice: 'Scarce in 10 — grading premium strongest. (est.)' },
    { label: 'Normal', maxPop: 1000, advice: 'Typical population — standard math applies. (est.)' },
    { label: 'Elevated', maxPop: 5000, advice: 'Plenty of 10s exist — premium compressing. (est.)' },
    { label: 'High pop', maxPop: Infinity, advice: 'Market flooded with 10s — grading premium weak; lean sell-raw. (est.)' },
  ];
  for (const t of tiers) if (pop <= t.maxPop) return t;
  return tiers[tiers.length - 1];
}

/* ---------- recommendation engine (uses verified thresholds) ---------- */
function gradeAdvice(c) {
  const T = State.intel.thresholds;
  if (c.graded) {
    return { verdict: 'no', title: `Already graded — ${c.grader || ''} ${c.grade || ''}`.trim(),
      body: `This slab is done. Sell graded on eBay (most liquid for slabs). A ${c.grader || 'PSA'} ${c.grade || ''} typically commands a premium over raw; check the graded comps below.` };
  }
  const p = c.price || 0;
  let threshold, eraLabel;
  if (c.era === 'vintage') { threshold = T.gradeVintageRaw; eraLabel = 'vintage'; }
  else if (c.era === 'retro') { threshold = 50; eraLabel = 'older'; }
  else if (c.era === 'modern') { threshold = c.lang === 'ja' ? 55 : T.gradeModernEnglishRaw; eraLabel = 'modern'; }
  else { threshold = 60; eraLabel = ''; }

  const lad = gradeLadder(c);
  const estPsa10 = lad.psa10;
  const allIn = T.allInGradingCost;
  const fee = 0.136; // eBay, where slabs sell
  // What lands in your pocket per outcome, vs simply selling raw today:
  const net10 = lad.psa10 * (1 - fee) - allIn;
  const net9 = lad.psa9 * (1 - fee) - allIn;
  const net8 = lad.psa8 * (1 - fee) - allIn;
  const nineSafe = net9 > p;          // even a 9 beats selling raw
  const eightSafe = net8 > p;         // even an 8 beats selling raw (rare outside vintage)
  const net = estPsa10 - p - allIn;
  const jpNote = c.lang === 'ja' ? ' Japanese cards also gem-grade more often, improving your odds of a 10.' : '';
  const downside = eightSafe
    ? `Downside is covered: even a PSA 8 (≈${money(lad.psa8)}) nets more than raw.`
    : nineSafe
      ? `A PSA 9 (≈${money(lad.psa9)}) still nets ≈${money(net9)} — beats selling raw, so an imperfect card is OK. A PSA 8 (≈${money(lad.psa8)}) would not.`
      : `<b>10-or-bust:</b> a PSA 9 (≈${money(lad.psa9)}) nets only ≈${money(net9)} after fees+grading — below the ${money(p)} raw. Only grade if it looks gem.`;

  if (p < T.gradeFloorRaw) {
    return { verdict: 'no', title: 'Not worth grading', estPsa10, lad, nineSafe, eightSafe,
      body: `At <b>${money(p)}</b> raw it’s below the ~${money(T.gradeFloorRaw, 0)} floor where grading (~${money(allIn, 0)} all-in at CGC Bulk/TAG) can pay off. Keep raw or sell as-is.` };
  }
  if (p >= threshold && net > p * 0.5) {
    return { verdict: 'strong', title: nineSafe ? 'Strong grading candidate — 9 still wins' : 'Strong candidate — needs the 10', estPsa10, lad, nineSafe, eightSafe,
      body: `${cap(eraLabel)} ${c.lang === 'ja' ? 'Japanese' : 'English'} card at <b>${money(p)}</b> raw. PSA 10 ≈ <b>${money(estPsa10)}</b> / PSA 9 ≈ ${money(lad.psa9)} / PSA 8 ≈ ${money(lad.psa8)}. ${downside}${jpNote}` };
  }
  if (p >= threshold * 0.7) {
    return { verdict: 'maybe', title: 'Borderline — grade only if near-mint', estPsa10, lad, nineSafe, eightSafe,
      body: `At <b>${money(p)}</b> raw it’s near the ${eraLabel} grading threshold (~${money(threshold, 0)}). ${downside}${jpNote}` };
  }
  return { verdict: 'no', title: 'Probably leave it raw', estPsa10, lad, nineSafe, eightSafe,
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

    ${gamePlanHTML()}

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
  wireGamePlan();
  wireActionBoard();
  wireFeedback();
}

/* ================= GAME PLAN (Now / Build / Invest) ================= */
// "Now" money-moves are generated live from the collection — no data file needed.
function buildNowMoves() {
  const moves = [];
  const raw = State.cards.filter(c => !c.graded && c.game === 'Pokémon');
  const allIn = (State.intel.thresholds && State.intel.thresholds.allInGradingCost) || 35;

  // 1. Best grading upside (net at PSA 10 minus raw, only "strong" verdicts)
  const gradeCands = raw.map(c => ({ c, a: gradeAdvice(c) }))
    .filter(x => x.a.verdict === 'strong')
    .map(x => ({ ...x, upside: x.a.lad.psa10 * (1 - 0.136) - allIn - x.c.price }))
    .sort((p, q) => q.upside - p.upside);
  if (gradeCands.length) {
    const g = gradeCands[0];
    moves.push({ icon: '🔬', tone: 'strong',
      title: `Grade ${g.c.name}${g.c.number ? ' #' + g.c.number : ''}`,
      detail: `PSA 10 ≈ ${money(g.a.lad.psa10)} vs ${money(g.c.price)} raw — ~${money(g.upside)} upside${g.a.nineSafe ? ', and a 9 still beats raw' : ' (10-or-bust)'}. ${gradeCands.length} strong candidates total.`,
      cta: 'Pre-grade it', go: () => { switchView('lab'); State.labTab = 'pregrade'; renderLab(); wirePregrade(); } });
  }

  // 2. Biggest realized gain available right now (high value, modern leans sell)
  const sellNow = raw.filter(c => (uget(c).status || '') !== 'sold' && c.value >= 40)
    .map(c => ({ c, pop: c.era === 'modern' })) // modern = more downside to holding
    .sort((p, q) => q.c.value - p.c.value);
  if (sellNow.length) {
    const s = sellNow[0].c, n = sellNet(s);
    moves.push({ icon: '💸', tone: 'gold',
      title: `Cash in ${s.name}${s.number ? ' #' + s.number : ''}`,
      detail: `Your top mover at ${money(s.value)} — nets ≈ ${money(n.net)} after fees. ${sellNow.filter(x => x.pop).length} modern cards worth ≥$40 (modern can soften as PSA pops climb).`,
      cta: 'Build listing', go: () => openListingComposer(s, false) });
  }

  // 3. Best percentage flip (bought cheap, worth a lot)
  const flips = raw.filter(c => c.cost > 0 && c.value >= 25 && c.plPct != null).sort((a, b) => b.plPct - a.plPct);
  if (flips.length && flips[0].plPct > 100) {
    const f = flips[0];
    const mult = f.cost > 0 ? f.value / f.cost : 0;
    const gain = f.plPct > 1000 ? `${money(f.pl)} (${mult.toFixed(0)}×)` : `${Math.round(f.plPct)}%`;
    moves.push({ icon: '📈', tone: 'green',
      title: `Lock the ${gain} gain on ${f.name}`,
      detail: `Paid ${money(f.cost)}, worth ${money(f.value)}. Pure profit sitting in a binder — strongest return in your collection.`,
      cta: 'Build listing', go: () => openListingComposer(f, false) });
  }

  // 4. Finish what's flagged
  const flagged = State.cards.filter(c => (uget(c).status || '') === 'forsale');
  if (flagged.length) {
    moves.push({ icon: '📤', tone: 'blue',
      title: `Finish listing ${flagged.length} flagged card${flagged.length > 1 ? 's' : ''}`,
      detail: `You marked ${money0(sum(flagged.map(c => c.value)))} worth “for sale” — get them posted on eBay or local FB.`,
      cta: 'Open Sell Hub', go: () => { switchView('sell'); State.sellTab = 'fs'; renderSell(); } });
  }

  // 5. Pop-check the biggest holdings (does grading still pay?)
  moves.push({ icon: '🔎', tone: '',
    title: 'Pop-check your top cards before grading',
    detail: 'High PSA-10 populations quietly erase the grading premium. Verify pop on your top movers in Pop Watch before you spend on slabs.',
    cta: 'Open Pop Watch', go: () => { switchView('sell'); State.sellTab = 'pop'; renderSell(); } });

  return moves.slice(0, 5);
}

function gamePlanHTML() {
  const P = State.plan;
  const moves = buildNowMoves();
  const toneColor = { strong: 'var(--green)', gold: 'var(--gold)', green: 'var(--green)', blue: 'var(--accent)', '': 'var(--muted)' };

  const nowCol = `
    <div class="gp-col">
      <div class="gp-h"><span class="gp-badge now">NOW</span> Next best money moves</div>
      <div class="gp-moves">${moves.map((m, i) => `
        <div class="gp-move" data-gp="${i}">
          <div class="gp-move-top"><span class="gp-ic">${m.icon}</span><b style="color:${toneColor[m.tone] || 'var(--text)'}">${esc(m.title)}</b></div>
          <div class="reason">${m.detail}</div>
          <button class="btn sm gp-cta" data-gp="${i}">${esc(m.cta)} →</button>
        </div>`).join('')}</div>
    </div>`;

  const buildCol = `
    <div class="gp-col">
      <div class="gp-h"><span class="gp-badge build">BUILD</span> Turn it into a business</div>
      ${P && P.llcConcept ? `
        <div class="reason" style="margin-bottom:8px">${esc(P.llcConcept.pitch)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${(P.llcConcept.nameIdeas || []).slice(0, 3).map(n => `<span class="chip gold">${esc(n)}</span>`).join('')}</div>
        <div class="gp-h2">Product lines</div>
        <ul class="bullets">${(P.llcConcept.productLines || []).slice(0, 4).map(pl => `<li><b>${esc(pl.name)}</b> — ${esc(pl.what)}</li>`).join('')}</ul>
        <div class="rec-box maybe" style="margin:8px 0 0;padding:10px 12px"><div class="rb" style="font-size:12.5px"><b>⚖ Stay legal:</b> ${esc((P.llcConcept.legalGuardrails || [''])[0])}</div></div>
        <button class="btn sm gold" id="gp-build-more" style="margin-top:10px">See full LLC plan →</button>
      ` : `<div class="reason">Your custom LLC concept — guaranteed-value mystery packs, nostalgia boxes, and 3D-printed display gear — is being researched now and lands with the next data update. The legality-first playbook will live here.</div>`}
    </div>`;

  const investCol = `
    <div class="gp-col">
      <div class="gp-h"><span class="gp-badge invest">INVEST</span> Smart next buys</div>
      ${P && P.invest ? `
        <div class="reason" style="margin-bottom:8px">${esc(P.invest.thesis)}</div>
        <div class="gp-h2">Top picks</div>
        <ul class="bullets">${(P.invest.buys || []).slice(0, 4).map(b => `<li><b>${esc(b.item)}</b> <span class="reason">${esc(b.range)} · ${esc(b.horizon)}</span><br><span class="reason">${esc(b.why)}</span></li>`).join('')}</ul>
        <button class="btn sm" id="gp-invest-more" style="margin-top:6px">See all picks & deploy plan →</button>
      ` : `<div class="reason">A grounded mid-2026 buy list — which sealed product, singles, and adjacent plays (incl. the 2026 LEGO Pokémon line) to deploy capital into — is being researched now and lands with the next data update.</div>`}
    </div>`;

  return `
    <div class="panel gp-panel" style="margin-top:16px">
      <h3 style="font-size:16px">🎯 Your Game Plan <span class="hint">— from today’s moves to the big picture</span></h3>
      <div class="gp-grid">${nowCol}${buildCol}${investCol}</div>
    </div>`;
}

function wireGamePlan() {
  const moves = buildNowMoves();
  $$('#view-dashboard .gp-move, #view-dashboard .gp-cta').forEach(el => {
    el.onclick = (e) => { e.stopPropagation(); const m = moves[+el.dataset.gp]; if (m && m.go) m.go(); };
  });
  if ($('#gp-build-more')) $('#gp-build-more').onclick = () => openPlanModal('build');
  if ($('#gp-invest-more')) $('#gp-invest-more').onclick = () => openPlanModal('invest');
}

function openPlanModal(which) {
  const P = State.plan; if (!P) return;
  let body = '';
  if (which === 'build' && P.llcConcept) {
    const L = P.llcConcept;
    body = `<h2 style="font-size:20px">🏗 The LLC plan</h2>
      <p class="reason" style="margin:4px 0 12px">${esc(L.pitch)}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${(L.nameIdeas || []).map(n => `<span class="chip gold">${esc(n)}</span>`).join('')}</div>
      <div class="subhead">Product lines</div>
      <table class="guide-table"><thead><tr><th>Line</th><th>Economics</th></tr></thead><tbody>
        ${(L.productLines || []).map(pl => `<tr><td><b>${esc(pl.name)}</b><br><span class="reason">${esc(pl.what)} · ⚖ ${esc(pl.legalNote)}</span></td><td class="reason">${esc(pl.economics)}</td></tr>`).join('')}
      </tbody></table>
      <div class="rec-box no" style="margin:14px 0"><div class="rh">⚖ Legal guardrails — read before you sell a single pack</div>
        <ul class="bullets" style="margin-top:6px">${(L.legalGuardrails || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="subhead">Startup steps</div>
      <ol class="bullets" style="padding-left:20px">${(L.startupSteps || []).map(s => `<li><b>${esc(s.step)}.</b> ${esc(s.detail)}</li>`).join('')}</ol>
      <div class="subhead">First moves this month</div>
      <ul class="bullets">${(L.firstMoves || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  } else if (which === 'invest' && P.invest) {
    const I = P.invest;
    body = `<h2 style="font-size:20px">💎 Where to invest next</h2>
      <p class="reason" style="margin:4px 0 12px">${esc(I.thesis)}</p>
      <div class="subhead">The buy list</div>
      <table class="guide-table"><thead><tr><th>Buy</th><th>Range</th><th>Horizon</th><th>Risk</th></tr></thead><tbody>
        ${(I.buys || []).map(b => `<tr><td><b>${esc(b.item)}</b><br><span class="reason">${esc(b.why)}</span></td><td style="white-space:nowrap">${esc(b.range)}</td><td class="reason">${esc(b.horizon)}</td><td class="reason">${esc(b.risk)}</td></tr>`).join('')}
      </tbody></table>
      <div class="subhead">If you’re deploying…</div>
      <table class="guide-table"><tbody>${(I.deployTiers || []).map(t => `<tr><td style="white-space:nowrap"><b>${esc(t.budget)}</b></td><td class="reason">${esc(t.mix)}</td></tr>`).join('')}</tbody></table>
      <div class="rec-box no" style="margin-top:14px"><div class="rh">Avoid / bubble warnings</div><ul class="bullets" style="margin-top:6px">${(I.avoid || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }
  const big = (P.bigIdeas && P.bigIdeas.length) ? `
    <div class="subhead">Bigger plays on the table</div>
    <div class="cols two">${P.bigIdeas.map(b => `<div class="rec-box maybe" style="margin:0 0 10px"><div class="rh">${esc(b.title)}</div><div class="rb">${esc(b.detail)}<br><span class="reason">Effort: ${esc(b.effort)} · Payoff: ${esc(b.payoff)}</span></div></div>`).join('')}</div>` : '';
  $('#modalRoot').innerHTML = `<div class="modal-bg" id="modalBg"><div class="modal" style="max-width:820px">
    <button class="close-x" id="modalClose">×</button>
    <div class="modal-body" style="padding:26px">${body}${big}
      <p class="reason" style="margin-top:14px">${esc(P.disclaimer || 'Researched June 2026 — educational, not legal or financial advice.')}</p>
    </div></div></div>`;
  $('#modalClose').onclick = closeModal;
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
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

  const popList = popWatchList();
  const tabs = [
    ['top', `Top sellers (${top.length})`],
    ['grade', `Grading candidates (${gradeCands.length})`],
    ['pop', `Pop watch (${popList.length})`],
    ['fs', `My for-sale list (${forSale.length})`],
  ];
  let body = '';
  if (State.sellTab === 'top') body = sellTable(top.map(x => ({ x })), 'top');
  else if (State.sellTab === 'grade') body = sellTable(gradeCands, 'grade');
  else if (State.sellTab === 'pop') body = popWatchHTML(popList);
  else body = forSale.length ? sellTable(forSale.map(x => ({ x })), 'fs')
    : `<div class="empty">No cards flagged yet. Open any card and hit <b>Mark “For sale”</b> to build your selling worklist here.</div>`;

  const gradeNote = State.sellTab === 'grade'
    ? `<p class="muted" style="font-size:12px;margin:0 2px 10px">Per-grade values are <b>estimates</b> from research-verified era ratios — every cell links to that grade’s real eBay sold comps, so click through before deciding. ${esc((gradeIntel().gradeRatios || {}).japaneseNote || '')}</p>` : '';
  $('#view-sell').innerHTML = `
    <div class="section-head"><h2>Sell Hub</h2>
      <span class="sub">Live sold comps + grading math. Fees baked into “net est.” (eBay ~13.6% / low-fee venues ~11%).</span></div>
    <div class="tabbar">${tabs.map(([v, l]) => `<button class="${State.sellTab === v ? 'active' : ''}" data-st="${v}">${l}</button>`).join('')}</div>
    ${gradeNote}${body}`;

  $$('#view-sell .tabbar button').forEach(b => b.onclick = () => { State.sellTab = b.dataset.st; renderSell(); });
  $$('#view-sell .sr-card, #view-sell .open-i').forEach(el => el.onclick = () => openModal(State.cards[+el.dataset.i]));
  $$('#view-sell .lc-open').forEach(b => b.onclick = (e) => { e.stopPropagation(); openListingComposer(State.cards[+b.dataset.i], false); });
  if (State.sellTab === 'pop') wirePopWatch(popList);
}

/* ---- Pop Watch: your top cards vs PSA population ---- */
function popWatchList() {
  // Top 75 raw Pokémon cards by value — the ones where the grade/pop question is live.
  return State.cards
    .filter(c => c.game === 'Pokémon' && !c.graded && (c.price || 0) >= 5)
    .sort((a, b) => b.value - a.value)
    .slice(0, 75);
}
function popWatchHTML(list) {
  const PI = (State.gintel && State.gintel.popIntel) || null;
  const PU = (State.gintel && State.gintel.popUrlTemplates) || {
    psaPopSearch: 'https://www.psacard.com/pop?q={q}',
    gemrate: 'https://gemrate.com/search?q={q}',
    psaApiNote: '',
  };
  const callout = `
    <div class="callout" style="margin-bottom:14px">
      <b>Does a high PSA-10 population kill the premium? </b>
      ${PI ? esc(PI.claimVerdict) : 'Generally yes — when thousands of PSA 10s exist, the 10 premium compresses toward raw. Verified guidance loads with the next data update.'}
      ${PI ? `<br><span class="muted" style="font-size:12.5px">${esc(PI.heuristic)}</span>` : ''}
      <br><span class="muted" style="font-size:12px">Check a card’s pop via the links, type the PSA 10 count in — your entry is saved and the verdict adapts. ${esc(PU.psaApiNote || '')}</span>
    </div>`;
  const rows = list.map(c => {
    const rec = popGet(c);
    const lad = gradeLadder(c);
    let badge = '<span class="reason">enter pop →</span>';
    if (rec) {
      const t = popTier(rec.pop);
      const col = /high/i.test(t.label) ? 'var(--red)' : /elev/i.test(t.label) ? 'var(--gold)' : 'var(--green)';
      badge = `<span class="reason" style="color:${col};font-weight:700">${esc(t.label)}</span><br><span class="reason" title="${esc(t.advice)}">${esc(t.advice.length > 60 ? t.advice.slice(0, 58) + '…' : t.advice)}</span>`;
    }
    return `<tr class="sell-row"><td>${sellCardCell(c)}</td>
      <td class="sr-val" style="color:var(--text)">${money(c.price)}</td>
      <td class="sr-val"><a href="${gradeSoldLink(c, 'PSA 10')}" target="_blank" rel="noopener" title="eBay sold — PSA 10">${money(lad.psa10)}</a></td>
      <td><input class="pop-inp" data-i="${c.i}" type="number" min="0" placeholder="PSA 10 pop" value="${rec ? rec.pop : ''}"></td>
      <td>${badge}</td>
      <td><div class="sr-links">
        <a class="minilink" href="${PU.psaPopSearch.replace('{q}', enc(c.name + ' ' + (c.number || '')))}" target="_blank" rel="noopener">PSA pop</a>
        <a class="minilink" href="${PU.gemrate.replace('{q}', enc(c.name))}" target="_blank" rel="noopener">GemRate</a>
        <a class="minilink" href="${gradeSoldLink(c, 'PSA 10')}" target="_blank" rel="noopener">Sold 10s</a>
      </div></td></tr>`;
  }).join('');
  return callout + `<table class="sell-table"><thead><tr>
    <th>Card</th><th>Raw value</th><th>Est. PSA 10</th><th>PSA 10 pop (you enter)</th><th>Pop verdict</th><th>Look it up</th>
  </tr></thead><tbody>${rows}</tbody></table>`;
}
function wirePopWatch(list) {
  $$('#view-sell .pop-inp').forEach(inp => {
    inp.onchange = () => { popSet(State.cards[+inp.dataset.i], inp.value); renderSell(); };
  });
}

function sellCardCell(c) {
  return `<div class="sr-card" data-i="${c.i}">
      ${c.img ? `<img loading="lazy" src="${c.img}" onerror="this.outerHTML=phThumb(${c.i})">` : phThumb(c.i)}
      <div><div class="sr-name">${esc(c.name)} ${c.graded ? `<span class="grade-chip" style="font-size:9px">${esc(c.grader || '')} ${c.grade || ''}</span>` : ''}</div>
        <div class="sr-set">${esc(c.set)} · ${c.lang === 'ja' ? 'JP' : 'EN'}${c.number ? ' · #' + esc(c.number) : ''}</div></div>
    </div>`;
}
function sellTable(rows, mode) {
  const svcNames = (gradeIntel().serviceDeltas || []).slice(0, 2).map(s => s.service);
  const head = mode === 'grade'
    ? `<th>Card</th><th>Raw</th><th>PSA 10</th><th>PSA 9</th><th>PSA 8</th>${svcNames.map(n => `<th>${esc(n)} 10</th>`).join('')}<th>Verdict</th><th>Comps</th>`
    : `<th>Card</th><th>Value</th><th>Net est.</th><th>P/L</th><th>Comps</th>`;
  return `<table class="sell-table"><thead><tr>${head}</tr></thead><tbody>${rows.map(r => sellRow(r, mode)).join('')}</tbody></table>`;
}
function gradeCell(c, label, value, cls) {
  return `<td class="sr-val grade-est ${cls || ''}"><a href="${gradeSoldLink(c, label)}" target="_blank" rel="noopener" title="eBay sold — ${esc(label)} (estimate; click for real comps)">${money(value)}</a></td>`;
}
function sellRow(r, mode) {
  const c = r.x, L = links(c);
  const pick = (name) => { const f = L.find(l => l.t.startsWith(name)); return f ? f.u : '#'; };
  const compCells = `<div class="sr-links">
      <button class="minilink lc-open" data-i="${c.i}" style="cursor:pointer;background:linear-gradient(135deg,var(--gold),#e7af2c);color:#1e1603;border-color:transparent;font-weight:700">📤 List</button>
      <a class="minilink" href="${pick('eBay — Sold (raw)')}" target="_blank" rel="noopener">eBay raw</a>
      <a class="minilink" href="${pick('eBay — Sold (graded)')}" target="_blank" rel="noopener">eBay graded</a>
      <a class="minilink" href="${pick(c.lang === 'ja' ? 'TCGplayer (JP)' : 'TCGplayer')}" target="_blank" rel="noopener">TCGplayer</a>
      <a class="minilink" href="${c.pcUrl || '#'}" target="_blank" rel="noopener">PriceCharting</a>
    </div>`;
  const cardCell = sellCardCell(c);
  if (mode === 'grade') {
    const a = r.a, lad = a.lad || gradeLadder(c);
    const vClass = a.verdict === 'strong' ? 'var(--green)' : 'var(--gold)';
    const vLabel = a.verdict === 'strong' ? '★ Strong' : 'Maybe';
    const nine = a.nineSafe
      ? `<span class="reason" style="color:var(--green)">9 still beats raw</span>`
      : `<span class="reason" style="color:var(--red)">10-or-bust</span>`;
    const svcs = (gradeIntel().serviceDeltas || []).slice(0, 2)
      .map(s => gradeCell(c, s.service + ' 10', lad.services[s.service] ? lad.services[s.service].v : 0, 'svc'))
      .join('');
    return `<tr class="sell-row"><td>${cardCell}</td>
      <td class="sr-val" style="color:var(--text)">${money(c.price)}</td>
      ${gradeCell(c, 'PSA 10', lad.psa10, 'g10')}
      ${gradeCell(c, 'PSA 9', lad.psa9, 'g9')}
      ${gradeCell(c, 'PSA 8', lad.psa8, 'g8')}
      ${svcs}
      <td><span class="reason" style="color:${vClass};font-weight:700">${vLabel}</span><br>${nine}</td>
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
    </div>
    ${localPlaybookHTML()}${sellerPlaybookHTML()}`;
}

/* ---- Seller Playbook (FB Marketplace, business structure, multi-line strategy) ---- */
function localPlaybookHTML() {
  const V = State.venues; if (!V || !V.local) return '';
  const L = V.local, A = V.automation || {};
  return `
    <div class="section-head" style="margin-top:30px"><h2>📍 Sell local — ${esc(L.area || 'Colorado Springs')}</h2>
      <span class="sub">Keep 100% with local cash — verified shops, groups, shows &amp; safe spots.</span></div>
    <div class="cols two">
      <div class="panel"><h3>Card shops that buy / consign</h3>
        <table class="guide-table"><tbody>${(L.shops || []).map(s => `<tr><td><b>${esc(s.name)}</b><br><span class="reason">${esc(s.where)}</span></td><td class="reason">${esc(s.note)}</td></tr>`).join('')}</tbody></table>
        <div class="subhead">Best local route by card value</div>
        <table class="guide-table"><tbody>${(L.byValueTier || []).map(t => `<tr><td style="white-space:nowrap"><b>${esc(t.tier)}</b></td><td class="reason">${esc(t.advice)}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="panel"><h3>Groups, shows &amp; apps</h3>
        <div class="subhead">Facebook groups</div><ul class="bullets">${(L.groups || []).map(g => `<li><b>${esc(g.name)}</b> — ${esc(g.note)}</li>`).join('')}</ul>
        <div class="subhead">Card shows / events</div><ul class="bullets">${(L.shows || []).map(s => `<li><b>${esc(s.name)}</b> <span class="reason">(${esc(s.cadence)})</span> — ${esc(s.note)}</li>`).join('')}</ul>
        <div class="subhead">Local-pickup apps</div><ul class="bullets">${(L.apps || []).map(a => `<li><b>${esc(a.name)}</b> — ${esc(a.note)}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Safe meetups &amp; the 0%-fee reality</h3>
        <ul class="bullets">${(L.safeSpots || []).concat(L.noFeeReality || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="panel"><h3>How far can we automate?</h3>
        <div class="subhead">Listing photos (stay legit)</div>
        <ul class="bullets">${(A.photoPolicy || []).concat(A.imageGuidance || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="subhead">What the eBay API would unlock (BYOK dev account)</div>
        <ul class="bullets">${(A.ebayApi || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${(A.crossListTools && A.crossListTools.length) ? `<div class="subhead">Cross-listing tools</div><ul class="bullets">${A.crossListTools.map(t => `<li><b>${esc(t.name)}</b> — ${esc(t.how)} <span class="reason">${esc(t.price)}</span></li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
}

function sellerPlaybookHTML() {
  const B = State.sellerbiz;
  if (!B) return `<div class="panel" style="margin-top:22px"><h3>📒 Seller Playbook</h3>
    <p class="muted" style="font-size:13px">Facebook Marketplace setup, LLC decision framework, and multi-line venue strategy load with the next data update. The FB venue already works in the 📤 listing composer.</p></div>`;
  const fb = B.facebook, llc = B.llc, ml = B.multiLine;
  return `
    <div class="section-head" style="margin-top:30px"><h2>📒 Seller Playbook</h2>
      <span class="sub">${esc(B.disclaimer || 'Researched June 2026. Educational, not legal or tax advice — confirm specifics with a professional.')}</span></div>

    <div class="cols two">
      <div class="panel"><h3>Facebook Marketplace — the 0%-fee venue</h3>
        <div class="subhead">Fee reality</div>
        <ul class="bullets">${fb.feeReality.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="subhead">Account setup for a card seller</div>
        <ol class="bullets" style="padding-left:20px">${fb.setupSteps.map(s => `<li><b>${esc(s.step)}.</b> ${esc(s.detail)}</li>`).join('')}</ol>
        <div class="subhead">What sells best there</div>
        <ul class="bullets">${fb.whatSellsBest.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="panel"><h3>Stay un-scammed</h3>
        <ul class="bullets">${fb.safetyRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <p class="reason" style="margin-top:8px">${esc(fb.urls.prefillNote)}</p>
      </div>
    </div>

    <div class="panel" style="margin-top:16px"><h3>LLC or not? The business question</h3>
      <div class="rec-box maybe" style="margin:8px 0 14px"><div class="rh">The verdict for your situation</div>
        <div class="rb">${esc(llc.verdict)}</div></div>
      <div class="cols two">
        <div>
          <div class="subhead">Taxes right now (1099-K & hobby vs business)</div>
          <ul class="bullets">${llc.ten99kNow.concat(llc.hobbyVsBusiness).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
        <div>
          <div class="subhead">What an LLC actually buys you</div>
          <ul class="bullets">${llc.llcEconomics.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
      </div>
      <div class="subhead">By revenue tier</div>
      <table class="guide-table"><thead><tr><th>Where you are</th><th>What to do</th></tr></thead><tbody>
        ${llc.decisionTiers.map(t => `<tr><td style="white-space:nowrap"><b>${esc(t.tier)}</b></td><td class="reason">${esc(t.advice)}</td></tr>`).join('')}
      </tbody></table>
      <div class="subhead">Setup checklist (either way)</div>
      <ol class="bullets" style="padding-left:20px">${llc.setupChecklist.map(s => `<li><b>${esc(s.step)}.</b> ${esc(s.detail)}</li>`).join('')}</ol>
    </div>

    <div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Cards · games · guitars · 3D prints — where each sells</h3>
        <table class="guide-table"><thead><tr><th>Line</th><th>Best venues</th><th>Fees</th></tr></thead><tbody>
          ${ml.venueMatrix.map(v => `<tr><td><b>${esc(v.line)}</b><br><span class="reason">${esc(v.note)}</span></td><td>${esc(v.bestVenues)}</td><td class="reason">${esc(v.fees)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="panel"><h3>Accounts & branding</h3>
        <div class="subhead">Account strategy</div>
        <ul class="bullets">${ml.accountStrategy.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="subhead">The 3D-print line (GradeStage etc.)</div>
        <ul class="bullets">${ml.printBrand.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="subhead">Cross-promotion that’s allowed</div>
        <ul class="bullets">${ml.crossPromo.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
    </div>`;
}

/* ================= DISPLAY CASE ================= */
const CASE_TIERS = ['🏆 Grails', '💎 Showcase', '📈 Risers', '👀 Watchlist'];
function caseAll() { return loadJSON(LS_CASE, {}); }
function caseGet(c) { return caseAll()[c.pcId] || null; }
function caseSet(c, patch) {
  const all = caseAll();
  all[c.pcId] = Object.assign({ tier: CASE_TIERS[0], note: '', added: new Date().toISOString().slice(0, 10) }, all[c.pcId] || {}, patch);
  localStorage.setItem(LS_CASE, JSON.stringify(all));
  recordCardSnaps();
}
function caseRemove(c) { const all = caseAll(); delete all[c.pcId]; localStorage.setItem(LS_CASE, JSON.stringify(all)); }

function recordCardSnaps() {
  // record today's price for every card currently on display (small footprint)
  const snaps = loadJSON(LS_CARDSNAP, {});
  const today = new Date().toISOString().slice(0, 10);
  const byId = {}; (State.cards || []).forEach(c => byId[c.pcId] = c);
  Object.keys(caseAll()).forEach(pcId => {
    const c = byId[pcId]; if (!c || c.price == null) return;
    (snaps[pcId] = snaps[pcId] || {})[today] = Math.round(c.price * 100) / 100;
  });
  localStorage.setItem(LS_CARDSNAP, JSON.stringify(snaps));
}

function cardTrend(c) {
  const hist = loadJSON(LS_CARDSNAP, {})[c.pcId] || {};
  const series = Object.entries(hist).sort((a, b) => a[0] < b[0] ? -1 : 1);
  if (series.length >= 2) {
    const first = series[0][1], last = series[series.length - 1][1];
    return { kind: 'tracked', pct: first ? (last - first) / first * 100 : 0, days: series.length, series };
  }
  if (c.cost > 0) return { kind: 'lifetime', pct: (c.value - c.cost * c.qty) / (c.cost * c.qty) * 100 };
  return { kind: 'new' };
}
function trendSpark(series) {
  if (!series || series.length < 2) return '';
  const v = series.map(s => s[1]), mn = Math.min(...v), mx = Math.max(...v), W = 120, H = 32, p = 3;
  const x = i => p + i * (W - 2 * p) / (series.length - 1), y = val => H - p - (mx === mn ? 0.5 : (val - mn) / (mx - mn)) * (H - 2 * p);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return `<svg viewBox="0 0 ${W} ${H}" class="dc-spark"><polyline points="${pts}" fill="none" stroke="${up ? 'var(--green)' : 'var(--red)'}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function renderCase() {
  const all = caseAll();
  const byId = {}; State.cards.forEach(c => byId[c.pcId] = c);
  const cards = Object.keys(all).map(id => byId[id]).filter(Boolean);
  const totVal = sum(cards.map(c => c.value));
  const head = `
    <div class="section-head"><h2>🏛 Display Case</h2>
      <span class="sub">${cards.length ? `${cards.length} favorites on display · ${money0(totVal)}` : 'Your curated showcase — favorites, grails, risers'}</span></div>
    <div class="dc-add">
      <input id="dc-search" list="dc-list" class="s-inp" style="margin:0;max-width:440px" placeholder="✚ Add a card to the case — type a name…">
      <datalist id="dc-list">${State.cards.filter(c => !all[c.pcId]).slice(0, 1200).map(c => `<option value="${esc(c.name)} — ${esc(c.set)}${c.number ? ' #' + esc(c.number) : ''}" data-i="${c.i}">`).join('')}</datalist>
    </div>`;
  if (!cards.length) {
    $('#view-case').innerHTML = head + `<div class="dc-empty"><div class="dc-empty-glow"></div>
      <p style="font-size:15px">Nothing on display yet.</p>
      <p class="reason">Open any card and hit <b>★ Display Case</b>, or use the search above. Sort favorites onto shelves (Grails, Risers, Watchlist…), add your own notes, watch each card’s value trend build over time, and jump straight to its full <b>PriceCharting</b> history.</p></div>`;
    wireCaseAdd(); return;
  }
  const tiers = [...new Set([...CASE_TIERS, ...cards.map(c => all[c.pcId].tier)])];
  const shelves = tiers.map(t => {
    const inTier = cards.filter(c => all[c.pcId].tier === t).sort((a, b) => b.value - a.value);
    if (!inTier.length) return '';
    return `<div class="dc-shelf">
      <div class="dc-shelf-h">${esc(t)} <span class="reason">${inTier.length} · ${money0(sum(inTier.map(c => c.value)))}</span></div>
      <div class="dc-grid">${inTier.map(c => caseFrameHTML(c, all[c.pcId])).join('')}</div></div>`;
  }).join('');
  $('#view-case').innerHTML = head + shelves;
  wireCaseAdd();
  $$('#view-case .dc-img, #view-case .dc-name').forEach(el => el.onclick = () => openModal(byId[el.dataset.pc]));
  $$('#view-case [data-edit]').forEach(b => b.onclick = (e) => { e.stopPropagation(); openCasePicker(byId[b.dataset.edit]); });
  $$('#view-case [data-rm]').forEach(b => b.onclick = (e) => { e.stopPropagation(); caseRemove(byId[b.dataset.rm]); renderCase(); });
}

function caseFrameHTML(c, rec) {
  const t = cardTrend(c);
  let trend;
  if (t.kind === 'tracked') {
    const up = t.pct >= 0;
    trend = `<div class="dc-trend">${trendSpark(t.series)}<span class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(t.pct).toFixed(1)}%</span><span class="reason">${t.days}d tracked</span></div>`;
  } else if (t.kind === 'lifetime') {
    const up = t.pct >= 0;
    trend = `<div class="dc-trend"><span class="${up ? 'up' : 'dn'}">${up ? '▲' : '▼'} ${Math.abs(t.pct).toFixed(0)}%</span><span class="reason">since you bought it · trend builds daily</span></div>`;
  } else {
    trend = `<div class="dc-trend reason">tracking starts today — history on PriceCharting →</div>`;
  }
  return `<div class="dc-frame">
    <div class="dc-img" data-pc="${c.pcId}">${c.img ? `<img loading="lazy" src="${c.img}" onerror="this.outerHTML=phHTML(${c.i})">` : phHTML(c.i)}
      ${c.graded ? `<span class="grade-chip" style="position:absolute;top:7px;right:7px">${esc(c.grader || '')} ${c.grade || ''}</span>` : ''}</div>
    <div class="dc-name" data-pc="${c.pcId}">${esc(c.name)}</div>
    <div class="dc-set">${esc(c.set)}${c.number ? ' · #' + esc(c.number) : ''}</div>
    <div class="dc-val">${money(c.value)}</div>
    ${trend}
    ${rec.note ? `<div class="dc-note">“${esc(rec.note)}”</div>` : ''}
    <a class="btn gold sm dc-pc" href="${c.pcUrl || '#'}" target="_blank" rel="noopener">📈 PriceCharting history</a>
    <div class="dc-actions"><button class="btn ghost sm" data-edit="${c.pcId}">Edit</button><button class="btn ghost sm" data-rm="${c.pcId}">Remove</button></div>
  </div>`;
}

function wireCaseAdd() {
  const s = $('#dc-search'); if (!s) return;
  s.onchange = () => {
    const opt = [...$('#dc-list').options].find(o => o.value === s.value);
    if (opt) { openCasePicker(State.cards[+opt.dataset.i]); s.value = ''; }
  };
}

function openCasePicker(c) {
  const rec = caseGet(c) || { tier: CASE_TIERS[0], note: '' };
  const presets = [...new Set([...CASE_TIERS, ...Object.values(caseAll()).map(r => r.tier)])];
  $('#modalRoot').innerHTML = `<div class="modal-bg" id="modalBg"><div class="modal" style="max-width:480px">
    <button class="close-x" id="modalClose">×</button>
    <div class="modal-body" style="padding:24px">
      <h2 style="font-size:18px;margin-bottom:2px">★ Display Case</h2>
      <p class="muted" style="font-size:12.5px;margin-bottom:12px">${esc(c.name)}${c.number ? ' #' + esc(c.number) : ''} · ${esc(c.set)} — ${money(c.value)}</p>
      <div class="subhead">Shelf / tier</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px" id="dc-tiers">
        ${presets.map(t => `<button class="btn sm dc-tier ${t === rec.tier ? 'gold' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <input id="dc-tier-custom" class="s-inp" placeholder="…or type a custom shelf name">
      <div class="subhead">Note / label</div>
      <textarea id="dc-note" class="s-inp" style="min-height:72px" placeholder="Why it's special, condition, a memory, a target price…">${esc(rec.note || '')}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn primary" id="dc-save">${caseGet(c) ? 'Save' : 'Add to case'}</button>
        ${caseGet(c) ? '<button class="btn ghost" id="dc-rm">Remove</button>' : ''}
      </div>
    </div></div></div>`;
  let tier = rec.tier;
  $$('#dc-tiers .dc-tier').forEach(b => b.onclick = () => { tier = b.dataset.t; $$('#dc-tiers .dc-tier').forEach(x => x.classList.remove('gold')); b.classList.add('gold'); $('#dc-tier-custom').value = ''; });
  $('#modalClose').onclick = closeModal; $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
  $('#dc-save').onclick = () => {
    const custom = $('#dc-tier-custom').value.trim();
    caseSet(c, { tier: custom || tier, note: $('#dc-note').value.trim() });
    closeModal(); switchView('case'); renderCase(); toast('Added to your Display Case.');
  };
  if ($('#dc-rm')) $('#dc-rm').onclick = () => { caseRemove(c); closeModal(); renderCase(); toast('Removed from case.'); };
}

/* ================= MERCH VAULT ================= */
const MERCH_CONDS = ['Factory sealed', 'CIB / with box', 'Built — all pieces + box', 'Built — no box', 'Loose', 'Display-cased'];
function merchItems() { return loadJSON(LS_MERCH, []); }
function merchSave(items) { localStorage.setItem(LS_MERCH, JSON.stringify(items)); }
function merchSoldLink(q) { return State.intel.urlTemplates.ebayRawSold.replace('{q}', enc('pokemon ' + q)); }
function merchActiveLink(q) {
  const t = State.intel.urlTemplates.ebayActive || State.intel.urlTemplates.ebayRawSold;
  return t.replace('{q}', enc('pokemon ' + q)).replace('&LH_Sold=1&LH_Complete=1', '');
}

function renderMerch() {
  const M = State.merch;
  const items = merchItems();
  const totEst = sum(items.filter(i => !i.soldFor).map(i => +i.est || 0));
  const totPaid = sum(items.map(i => +i.paid || 0));
  const realized = sum(items.filter(i => i.soldFor).map(i => (+i.soldFor || 0) - (+i.paid || 0)));

  const tracker = `
    <div class="panel" style="margin-bottom:16px">
      <h3>My merch tracker <span class="hint">— sealed boxes, games, plush, anything; saved locally</span></h3>
      <div class="merch-form">
        <input id="mi-name" type="text" placeholder="Item — e.g. Lucario V / Tyranitar V Costco box (14 packs)" style="flex:2 1 260px">
        <select id="mi-cat">${(M ? M.merchCategories : [{ key: 'sealed', name: 'Sealed TCG' }]).map(cat => `<option value="${esc(cat.key)}">${esc(cat.name)}</option>`).join('')}<option value="other">Other</option></select>
        <select id="mi-cond">${MERCH_CONDS.map(x => `<option>${esc(x)}</option>`).join('')}</select>
        <input id="mi-paid" type="number" min="0" step="0.01" placeholder="Paid $" style="width:90px">
        <input id="mi-est" type="number" min="0" step="0.01" placeholder="Est. $" style="width:90px">
        <button class="btn primary sm" id="mi-add">+ Add</button>
      </div>
      ${items.length ? `<table class="sell-table" style="margin-top:10px"><thead><tr><th>Item</th><th>Condition</th><th>Paid</th><th>Est. / Sold</th><th>P/L</th><th>Comps</th><th></th></tr></thead><tbody>
        ${items.map((it, idx) => {
          const pl = it.soldFor ? (+it.soldFor || 0) - (+it.paid || 0) : (+it.est || 0) - (+it.paid || 0);
          return `<tr class="sell-row${it.soldFor ? ' merch-sold' : ''}"><td><div class="sr-name">${esc(it.name)}</div><div class="sr-set">${esc(it.cat)}${it.note ? ' · ' + esc(it.note) : ''}</div></td>
          <td class="reason">${esc(it.cond || '—')}</td>
          <td class="sr-val" style="color:var(--text)">${money(+it.paid || 0)}</td>
          <td class="sr-val">${it.soldFor ? `<span style="color:var(--green)">SOLD ${money(+it.soldFor)}</span>` : money(+it.est || 0)}</td>
          <td><span class="reason" style="color:${pl >= 0 ? 'var(--green)' : 'var(--red)'}">${pl >= 0 ? '+' : ''}${money(pl)}</span></td>
          <td><div class="sr-links"><a class="minilink" href="${merchSoldLink(it.name + ' ' + (it.cond === 'Factory sealed' ? 'sealed' : ''))}" target="_blank" rel="noopener">eBay sold</a><a class="minilink" href="${merchActiveLink(it.name)}" target="_blank" rel="noopener">Active</a></div></td>
          <td><div class="sr-links">${it.soldFor ? '' : `<button class="btn sm" data-msold="${idx}">Sold…</button>`}<button class="btn ghost sm" data-mdel="${idx}">✕</button></div></td></tr>`;
        }).join('')}
      </tbody></table>
      <div class="reason" style="margin-top:8px">Holding est. <b style="color:var(--gold)">${money0(totEst)}</b> · paid ${money0(totPaid)} · realized profit <b style="color:${realized >= 0 ? 'var(--green)' : 'var(--red)'}">${money0(realized)}</b></div>`
      : `<p class="muted" style="font-size:13px;margin:10px 2px 2px">Nothing tracked yet. Add your sealed boxes, games, plush — like that Costco Lucario V / Tyranitar V box you flipped. Each item gets live eBay comp links.</p>`}
    </div>`;

  const rules = M && M.sealedRules && M.sealedRules.length ? `
    <div class="callout" style="margin-bottom:16px"><b>Sealed &amp; merch ground rules.</b>
      <ul class="bullets" style="margin-top:6px">${M.sealedRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    </div>` : '';

  const cats = M && M.merchCategories ? `
    <div class="guide-grid">${M.merchCategories.map(cat => `
      <div class="panel"><h3>${esc(cat.name)}</h3>
        <p class="muted" style="font-size:12.5px;margin:0 0 8px">${esc(cat.blurb)}</p>
        <table class="guide-table"><thead><tr><th>Item</th><th>Value</th></tr></thead><tbody>
          ${cat.examples.map(ex => `<tr><td><a href="${merchSoldLink(ex.item)}" target="_blank" rel="noopener">${esc(ex.item)}</a><br><span class="reason">${esc(ex.note)}</span></td><td style="white-space:nowrap"><b>${esc(ex.valueRange)}</b></td></tr>`).join('')}
        </tbody></table>
        <div class="subhead" style="margin-top:10px">Condition rules</div>
        <ul class="bullets">${cat.conditionRules.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>` : `<div class="panel"><h3>Market guide loading…</h3><p class="muted" style="font-size:13px">The curated merch value guide (sealed product, games, LEGO, Funko, plush) ships with the next data update — your tracker above works now.</p></div>`;

  $('#view-merch').innerHTML = `
    <div class="section-head"><h2>Merch Vault</h2>
      <span class="sub">Beyond singles — sealed product, video games, LEGO, Funko, plush. Item values link to real eBay solds.</span></div>
    ${tracker}${rules}${cats}`;

  // wiring
  $('#mi-add').onclick = () => {
    const name = $('#mi-name').value.trim();
    if (!name) { toast('Give the item a name first.'); return; }
    const items2 = merchItems();
    items2.unshift({ id: Date.now(), name, cat: $('#mi-cat').value, cond: $('#mi-cond').value, paid: $('#mi-paid').value, est: $('#mi-est').value });
    merchSave(items2); renderMerch(); toast('Added to your merch tracker.');
  };
  $$('#view-merch [data-mdel]').forEach(b => b.onclick = () => {
    const items2 = merchItems(); items2.splice(+b.dataset.mdel, 1); merchSave(items2); renderMerch();
  });
  $$('#view-merch [data-msold]').forEach(b => b.onclick = () => {
    const v = prompt('Sold for how much? ($)');
    if (v == null || v === '' || isNaN(+v)) return;
    const items2 = merchItems(); items2[+b.dataset.msold].soldFor = +v;
    items2[+b.dataset.msold].soldDate = new Date().toISOString().slice(0, 10);
    merchSave(items2); renderMerch(); toast('Nice flip — recorded.');
  });
}

/* ================= GRADE LAB ================= */
const LS_PREGRADE = 'pokechest.pregrade.v1';
const LAB_FALLBACK_STANDARDS = [
  { grade: 'PSA 10', front: '55/45 or better', back: '75/25 or better', note: 'Gem Mint (fallback — verified standards load with data update)' },
  { grade: 'PSA 9', front: '60/40 or better', back: '90/10 or better', note: 'Mint' },
  { grade: 'PSA 8', front: '65/35 or better', back: '90/10 or better', note: 'NM-Mint' },
  { grade: 'PSA 7', front: '70/30 or better', back: '90/10 or better', note: 'Near Mint' },
];
function labData() { return State.lab || null; }
function labStandards() { return (labData() && labData().centeringStandards) || LAB_FALLBACK_STANDARDS; }
function labDowngraders() {
  return (labData() && labData().downgraders) || [
    { flaw: 'Print line through holo or artwork', dropsTo: 'PSA 9 or lower', howToDetect: 'Raking light at a low angle across the surface', severityRule: 'Any visible line caps at 9 (fallback list — verified data loads with update)' },
    { flaw: 'Surface scratch on holofoil', dropsTo: 'PSA 9 or lower', howToDetect: 'Tilt under a single bright point light', severityRule: 'Light scuffs cap at 9; clusters go lower' },
    { flaw: 'Whitening on back edges/corners', dropsTo: 'PSA 8-9', howToDetect: 'Dark background, angled light on the card back', severityRule: 'One tiny fleck may survive a 9; multiple spots cap at 8' },
    { flaw: 'Soft / non-sharp corner', dropsTo: 'PSA 8-9', howToDetect: '10x loupe on each corner', severityRule: 'All four corners must be sharp for a 10' },
  ];
}
function parseGradeNum(s) { const m = String(s).match(/(\d+(?:\.\d)?)/); return m ? +m[1] : 7; }
function parseDropCap(s) {
  // "10 → 9", "10 → 9 (8 if naked-eye)", "Caps below 10 (usually 9)", "PSA 8-9"
  // → the grade the flaw caps at = second-highest distinct number mentioned
  const nums = [...String(s).matchAll(/\d+(?:\.\d)?/g)].map(m => +m[0]).filter(n => n <= 10);
  if (!nums.length) return 9;
  const uniq = [...new Set(nums)].sort((a, b) => b - a);
  return uniq.length === 1 ? uniq[0] : uniq[1];
}
function parseAllow(frontStr) { const m = String(frontStr).match(/(\d+)\s*\/\s*\d+/); return m ? +m[1] : 60; }
function centeringFromBorders(a, b) {
  // a, b: opposite border widths in any consistent unit → worst-side percentage
  if (!(a > 0) || !(b > 0)) return null;
  const worst = Math.max(a, b) / (a + b) * 100;
  const w = Math.round(worst);
  return { worst, label: `${w}/${100 - w}` };
}
function centeringCeiling(worstPct) {
  const rows = labStandards().map(r => ({ g: parseGradeNum(r.grade), allow: parseAllow(r.front), row: r }))
    .sort((x, y) => y.g - x.g);
  for (const r of rows) if (worstPct <= r.allow + 0.0001) return r;
  return null; // worse than the lowest listed grade
}
function pregradeAll() { return loadJSON(LS_PREGRADE, {}); }
function pregradeSet(pcId, rec) {
  const all = pregradeAll();
  if (rec) all[pcId] = rec; else delete all[pcId];
  localStorage.setItem(LS_PREGRADE, JSON.stringify(all));
}

function renderLab() {
  const L = labData();
  State.labTab = State.labTab || 'bench';
  const tabs = [['bench', 'The grading bench'], ['pregrade', 'Pre-grade a card'], ['standards', 'Standards & downgraders']];
  let body = '';
  if (State.labTab === 'bench') body = labBenchHTML(L);
  else if (State.labTab === 'pregrade') body = labPregradeHTML();
  else body = labStandardsHTML(L);
  $('#view-lab').innerHTML = `
    <div class="section-head"><h2>Grade Lab</h2>
      <span class="sub">Replicate the PSA bench at home — judge a card the way a grader will before you pay to find out.</span></div>
    <div class="tabbar">${tabs.map(([v, l]) => `<button class="${State.labTab === v ? 'active' : ''}" data-lt="${v}">${l}</button>`).join('')}</div>
    ${body}`;
  $$('#view-lab .tabbar button').forEach(b => b.onclick = () => { State.labTab = b.dataset.lt; renderLab(); });
  if (State.labTab === 'pregrade') wirePregrade();
}

function labBenchHTML(L) {
  const bench = L && L.graderBench;
  const steps = (L && L.processSteps) || [];
  return `
    ${bench ? `<div class="cols two">
      <div class="panel"><h3>How a PSA grader actually looks at your card</h3>
        <ul class="bullets">
          <li><b>Lighting:</b> ${esc(bench.lighting)}</li>
          <li><b>Magnification:</b> ${esc(bench.magnification)}</li>
          <li><b>Handling:</b> ${esc(bench.handling)}</li>
          <li><b>Time per card:</b> ${esc(bench.timePerCard)}</li>
        </ul>
      </div>
      <div class="panel"><h3>Recreate it at home</h3>
        <ul class="bullets">
          ${((L && L.rigSpecs && L.rigSpecs.lightingSpec) || ['Verified lighting spec loads with the data update.']).map(x => `<li>${esc(x)}</li>`).join('')}
        </ul>
        <p class="reason" style="margin-top:8px">The <b>GradeStage rig</b> (🛠 Admin tab) 3D-prints the exact geometry: raking-light bars for scratches/print lines, 45° bars for color & centering shots, and a phone tower for repeatable framing.</p>
      </div>
    </div>` : `<div class="panel"><h3>Verified bench details load with the next data update</h3><p class="muted" style="font-size:13px">The pre-grade workflow below already works.</p></div>`}
    ${steps.length ? `<div class="panel" style="margin-top:16px"><h3>What happens inside PSA</h3>
      <ol class="bullets" style="padding-left:20px">${steps.map(s => `<li><b>${esc(s.step)}.</b> ${esc(s.detail)}</li>`).join('')}</ol></div>` : ''}`;
}

function labPregradeHTML() {
  const cards = State.cards.filter(c => c.game === 'Pokémon' && !c.graded).sort((a, b) => b.value - a.value).slice(0, 400);
  const dg = labDowngraders();
  return `
    <div class="cols side">
      <div class="panel"><h3>1 · Pick the card</h3>
        <input id="pg-search" class="s-inp" list="pg-list" placeholder="Type a card name…">
        <datalist id="pg-list">${cards.map(c => `<option value="${esc(c.name)} — ${esc(c.set)}${c.number ? ' #' + esc(c.number) : ''}" data-i="${c.i}">`).join('')}</datalist>
        <div id="pg-cardbox" class="muted" style="font-size:13px">No card selected — you can still use the centering calculator below.</div>
      </div>
      <div class="panel"><h3>2 · Centering calculator</h3>
        <p class="reason">Photograph the card straight-on (GradeStage crosshairs help), then measure the four borders in any unit — mm, or pixels from a screenshot.</p>
        <div class="merch-form" style="margin-top:6px">
          <input id="pg-left" type="number" step="0.1" min="0" placeholder="Left" style="width:74px">
          <input id="pg-right" type="number" step="0.1" min="0" placeholder="Right" style="width:74px">
          <input id="pg-top" type="number" step="0.1" min="0" placeholder="Top" style="width:74px">
          <input id="pg-bottom" type="number" step="0.1" min="0" placeholder="Bottom" style="width:74px">
        </div>
        <div id="pg-centering" class="rb muted" style="font-size:13px;margin-top:8px">Enter borders to compute centering.</div>
      </div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>3 · Flaw checklist <span class="hint">— check anything you can see using the listed light technique</span></h3>
      <div id="pg-checks">${dg.map((d, i) => `
        <label class="pg-check"><input type="checkbox" data-di="${i}">
          <span><b>${esc(d.flaw)}</b> <span class="reason">(caps at ${esc(d.dropsTo)})</span><br>
          <span class="reason">Detect: ${esc(d.howToDetect)} · ${esc(d.severityRule)}</span></span></label>`).join('')}
      </div>
    </div>
    <div id="pg-verdict" class="rec-box no" style="margin-top:16px"><div class="rh">○ Estimated grade appears here</div>
      <div class="rb">Pick a card, enter centering, and check any flaws — the verdict combines them against PSA standards and your card’s grade ladder.</div></div>`;
}

function wirePregrade() {
  let current = null;
  const saved = pregradeAll();
  const findCard = (val) => {
    const opt = [...$('#pg-list').options].find(o => o.value === val);
    return opt ? State.cards[+opt.dataset.i] : null;
  };
  const update = () => {
    const L = +($('#pg-left').value || 0), R = +($('#pg-right').value || 0);
    const T = +($('#pg-top').value || 0), B = +($('#pg-bottom').value || 0);
    const lr = centeringFromBorders(L, R), tb = centeringFromBorders(T, B);
    let centCeil = null, centTxt = 'Enter borders to compute centering.';
    if (lr || tb) {
      const worst = Math.max(lr ? lr.worst : 0, tb ? tb.worst : 0);
      const ceil = centeringCeiling(worst);
      centCeil = ceil ? ceil.g : 6;
      const w = Math.round(worst);
      centTxt = `L/R <b>${lr ? lr.label : '—'}</b> · T/B <b>${tb ? tb.label : '—'}</b> → worst axis <b>${w}/${100 - w}</b> → centering supports <b style="color:var(--gold)">${ceil ? esc(ceil.row.grade) : 'below PSA 7'}</b>`;
    }
    $('#pg-centering').innerHTML = centTxt;
    const dg = labDowngraders();
    let checkCeil = 10;
    $$('#pg-checks input:checked').forEach(cb => {
      checkCeil = Math.min(checkCeil, parseDropCap(dg[+cb.dataset.di].dropsTo));
    });
    const est = Math.min(centCeil == null ? 10 : centCeil, checkCeil);
    const box = $('#pg-verdict');
    if (centCeil == null && checkCeil === 10 && !current) return;
    let cls = est >= 10 ? 'strong' : est >= 9 ? 'maybe' : 'no';
    let head = est >= 10 ? '★ Looks like a 10 candidate' : est >= 9 ? `◐ Tops out around PSA ${est}` : `○ Caps at PSA ${est} — think raw`;
    let body = `Centering ceiling: <b>${centCeil == null ? 'not measured' : 'PSA ' + centCeil}</b> · flaw ceiling: <b>PSA ${checkCeil}</b>.`;
    if (current) {
      const lad = gradeLadder(current);
      const vals = { 10: lad.psa10, 9: lad.psa9, 8: lad.psa8 };
      const est$ = vals[Math.min(10, Math.max(8, est))] || lad.psa8;
      const net = est$ * (1 - 0.136) - (State.intel.thresholds.allInGradingCost || 35);
      const beats = net > (current.price || 0);
      body += ` For <b>${esc(current.name)}</b>: a PSA ${est} ≈ <b>${money(est$)}</b>, netting ≈ ${money(net)} after fees+grading vs <b>${money(current.price)}</b> raw → <b style="color:${beats ? 'var(--green)' : 'var(--red)'}">${beats ? 'grading still wins at this grade' : 'sell raw unless it grades higher'}</b>.`;
      pregradeSet(current.pcId, { est, centering: centCeil, flaws: $$('#pg-checks input:checked').length, date: new Date().toISOString().slice(0, 10) });
    }
    box.className = 'rec-box ' + cls;
    box.innerHTML = `<div class="rh">${head}</div><div class="rb">${body}</div>`;
  };
  $('#pg-search').oninput = () => {
    const c = findCard($('#pg-search').value);
    current = c;
    if (c) {
      const pre = saved[c.pcId];
      $('#pg-cardbox').innerHTML = `<div class="mini" style="cursor:default">${c.img ? `<img class="thumb" src="${c.img}">` : ''}<div class="mtext"><div class="mname">${esc(c.name)}</div><div class="mset">${esc(c.set)} · raw ${money(c.price)}${pre ? ` · last pre-grade: PSA ${pre.est} (${pre.date})` : ''}</div></div></div>`;
      update();
    }
  };
  ['pg-left', 'pg-right', 'pg-top', 'pg-bottom'].forEach(id => $('#' + id).oninput = update);
  $$('#pg-checks input').forEach(cb => cb.onchange = update);
}

function labStandardsHTML(L) {
  const dg = labDowngraders();
  return `
    <div class="cols two">
      <div class="panel"><h3>PSA centering standards</h3>
        <table class="guide-table"><thead><tr><th>Grade</th><th>Front</th><th>Back</th><th></th></tr></thead><tbody>
          ${labStandards().map(r => `<tr><td><b>${esc(r.grade)}</b></td><td>${esc(r.front)}</td><td>${esc(r.back)}</td><td class="reason">${esc(r.note)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="panel"><h3>Arguing a grade / pre-screening</h3>
        <ul class="bullets">${((L && L.reviewOptions) || ['Verified review/appeal mechanics load with the data update.']).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${L && L.jpHoloNotes && L.jpHoloNotes.length ? `<div class="subhead">Japanese & holo-era notes</div><ul class="bullets">${L.jpHoloNotes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>What knocks a 10 down — ranked</h3>
      <table class="guide-table"><thead><tr><th>Flaw</th><th>Caps at</th><th>How to detect it</th><th>Severity rule</th></tr></thead><tbody>
        ${dg.map(d => `<tr><td><b>${esc(d.flaw)}</b></td><td style="white-space:nowrap">${esc(d.dropsTo)}</td><td class="reason">${esc(d.howToDetect)}</td><td class="reason">${esc(d.severityRule)}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

/* ================= SUBMIT ================= */
function renderSubmit() {
  const S = State.submit;
  if (!S) {
    $('#view-submit').innerHTML = `<div class="section-head"><h2>Submit</h2></div>
      <div class="panel"><h3>Submission guide loads with the next data update</h3>
      <p class="muted" style="font-size:13px">Meanwhile: <a href="https://www.psacard.com/services/tradingcardgrading" target="_blank" rel="noopener">PSA grading</a> · <a href="https://www.cgccards.com" target="_blank" rel="noopener">CGC</a> · <a href="https://taggrading.com" target="_blank" rel="noopener">TAG</a></p></div>`;
    return;
  }
  const lk = S.links || {};
  const linkBtn = (label, sub, url) => url ? `<a class="linkbtn" href="${esc(url)}" target="_blank" rel="noopener"><span class="lb-t">${esc(label)} ↗</span><span class="lb-s">${esc(sub)}</span></a>` : '';
  $('#view-submit').innerHTML = `
    <div class="section-head"><h2>Submit for grading</h2>
      <span class="sub">The PSA process end-to-end, what turnarounds actually look like right now, and when to route elsewhere.</span></div>
    <div class="linkgrid" style="margin-bottom:16px">
      ${linkBtn('PSA — start a submission', 'Official submission portal', lk.psaSubmit)}
      ${linkBtn('PSA — pricing & service levels', 'Current tiers and costs', lk.psaPricing)}
      ${linkBtn('PSA — grading standards', 'The official rubric', lk.psaStandards)}
      ${linkBtn('PSA — track your order', 'Order status stages', lk.psaTracking)}
      ${linkBtn('CGC Cards', 'Submission portal', lk.cgc)}
      ${linkBtn('TAG Grading', 'Submission portal', lk.tag)}
      ${linkBtn('Beckett (BGS)', 'Submission portal', lk.bgs)}
    </div>
    <div class="cols two">
      <div class="panel"><h3>PSA step-by-step</h3>
        <ol class="bullets" style="padding-left:20px">${(S.psaSteps || []).map(s => `<li><b>${esc(s.step)}.</b> ${esc(s.detail)}</li>`).join('')}</ol>
      </div>
      <div class="panel"><h3>Packaging rules <span class="hint">— get this wrong and cards come back ungraded</span></h3>
        <ul class="bullets">${(S.packagingRules || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>Service levels — advertised vs actual (mid-2026)</h3>
      <table class="guide-table"><thead><tr><th>Service</th><th>Tier</th><th>Cost</th><th>Advertised</th><th>Actual</th><th>Status</th></tr></thead><tbody>
        ${(S.serviceStatus || []).map(r => `<tr><td><b>${esc(r.service)}</b></td><td>${esc(r.tier)}</td><td>${esc(r.cost)}</td><td>${esc(r.advertised)}</td><td>${esc(r.actual)}</td><td class="reason">${esc(r.status)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Beating the backlog</h3>
        <ul class="bullets">${(S.delayGuidance || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>
      <div class="panel"><h3>When to use someone else</h3>
        ${(S.alternatives || []).map(a => `<div class="subhead">${esc(a.service)}</div><p class="reason" style="margin:0 0 6px">${esc(a.whenToUse)} · ${esc(a.costTurnaround)} · ${esc(a.resaleTradeoff)}</p>`).join('')}
      </div>
    </div>`;
}

/* ================= ADMIN (DarkHearts R&D) ================= */
const LS_RND = 'pokechest.rnd.v1';
const RND_ROADMAP = [
  ['print-proto', 'Print GradeStage prototype (base + 2 LED bars + 4 columns + bridge)'],
  ['source-leds', 'Order BOM: CRI-90+ LED strips, polarizing film, 10x loupe, calipers'],
  ['polar-test', 'Test cross-polarization on a holo (film on LEDs + CPL on phone)'],
  ['baseline', 'Shoot 10 cards, pre-grade them, submit 2-3 and compare PSA results'],
  ['iterate', 'v2 geometry tweaks from real use (angles, phone height, bay fit)'],
  ['listing', 'Package as a sellable kit: prints + BOM + guide (Etsy/eBay listing)'],
];
function renderAdmin() {
  const R = (State.lab && State.lab.rigSpecs) || null;
  const done = loadJSON(LS_RND, {});
  const stls = ['gradestage-base.stl', 'gradestage-ledbar.stl (print 2)', 'gradestage-column.stl (print 4)', 'gradestage-bridge.stl'];
  const liveOn = !!State.live;
  $('#view-admin').innerHTML = `
    <div class="section-head"><h2>🛠 Admin — DarkHearts R&D</h2>
      <span class="sub">GradeStage: a 3D-printed card imaging rig — from collection scans to PSA-bench-grade capture. Build it, prove it, sell it.</span></div>

    <div class="panel" style="margin-bottom:16px"><h3>📱 Take it with you — iPhone Pocket Edition</h3>
      <p class="muted" style="font-size:13.5px;line-height:1.6">A single self-contained file — <code>Pokémon Chest — Pocket.html</code> in your project folder — with your whole collection, the Game Plan, and tap-to-open comp links baked in. Works offline; no app store, no account.</p>
      <ol class="bullets" style="padding-left:20px">
        <li><b>AirDrop</b> <code>Pokémon Chest — Pocket.html</code> from the project folder to your iPhone (or email it to yourself).</li>
        <li>Open it in <b>Safari</b> → Share → <b>Add to Home Screen</b>. It gets the chest icon and launches full-screen like an app.</li>
        <li>It’s a <b>snapshot</b> — tap <b>Regenerate</b> below (or refresh prices) after you update your collection, then re-AirDrop.</li>
      </ol>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px">
        <a class="btn sm gold" href="/Pok%C3%A9mon%20Chest%20%E2%80%94%20Pocket.html" target="_blank" rel="noopener">Open Pocket Edition ↗</a>
        ${liveOn ? '<button class="btn sm" id="ad-pocket">↻ Regenerate from latest data</button>' : '<span class="reason">Launch via start.command to regenerate from inside the app.</span>'}
        <span class="reason" id="ad-pocket-status"></span>
      </div>
    </div>

    <div class="cols side">
      <div class="panel"><h3>Product brief</h3>
        <p class="muted" style="font-size:13.5px;line-height:1.6">
        <b style="color:var(--text)">GradeStage</b> is a printable stage that makes card photos <i>repeatable</i>: a recessed bay holds a raw card, penny sleeve, or Card Saver 1 dead-center under engraved crosshairs; snap-in LED bars give <b>20° raking light</b> (the angle that exposes print lines and holo scratches — the stuff that turns a 10 into a 9) and <b>45° even light</b> (true color + centering shots); a stacking tower holds the phone at a fixed height so every card is framed identically — which is exactly what the in-app centering calculator wants.</p>
        <p class="muted" style="font-size:13.5px;line-height:1.6">Sell as: <b>STL files + BOM + guide</b> (digital, ~$12-19), or <b>printed kit with LEDs + polarizer film</b> (~$49-69). Companion app angle: Pokémon Chest's Grade Lab is the software half.</p>
        <div class="subhead">Print files (in repo: hardware/gradestage/)</div>
        <ul class="bullets">
          <li><code>gradestage.scad</code> — parametric source (OpenSCAD, free)</li>
          ${stls.map(s => `<li><code>stl/${esc(s)}</code></li>`).join('')}
        </ul>
        <p class="reason">PLA fine; PETG for the LED bars if strips run warm. 0.2mm layers, no supports needed except bridge (or print bridge upside-down).</p>
        <div class="subhead">Assembly</div>
        <ul class="bullets">
          <li>Stick two ~110mm LED strip segments into the bar channels, wires out the end holes</li>
          <li>Drop bars into the inner sockets (20° raking) for flaw-hunting; outer sockets (45°) for color/centering shots</li>
          <li>Stack 4 columns per side into the corner sockets, seat the bridge, phone in the slot — camera over the window</li>
          <li>For holos: polarizing film over the strips + CPL (or second film, rotated 90°) over the lens kills glare completely</li>
        </ul>
      </div>
      <div class="panel"><h3>R&D roadmap</h3>
        ${RND_ROADMAP.map(([id, label]) => `<label class="pg-check"><input type="checkbox" data-rnd="${id}" ${done[id] ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}
        <div class="subhead" style="margin-top:14px">Bench specs (research-verified)</div>
        <ul class="bullets">${((R && R.lightingSpec) || ['Verified lighting + capture specs load with the data update.']).slice(0, 5).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${R && R.centeringMath ? `<div class="subhead">Centering math</div><p class="reason">${esc(R.centeringMath)}</p>` : ''}
      </div>
    </div>
    ${R ? `<div class="cols two" style="margin-top:16px">
      <div class="panel"><h3>Bill of materials</h3>
        <table class="guide-table"><thead><tr><th>Item</th><th>Spec</th><th>Price</th></tr></thead><tbody>
          ${R.bom.map(b => `<tr><td><b>${esc(b.item)}</b></td><td class="reason">${esc(b.spec)}</td><td style="white-space:nowrap">${esc(b.price)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="panel"><h3>Competing products to beat</h3>
        <table class="guide-table"><thead><tr><th>Product</th><th>Price</th></tr></thead><tbody>
          ${R.benchmarks.map(b => `<tr><td><b>${esc(b.product)}</b><br><span class="reason">${esc(b.note)}</span></td><td style="white-space:nowrap">${esc(b.price)}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>` : ''}`;
  $$('#view-admin [data-rnd]').forEach(cb => cb.onchange = () => {
    const d = loadJSON(LS_RND, {}); d[cb.dataset.rnd] = cb.checked; localStorage.setItem(LS_RND, JSON.stringify(d));
  });
  if ($('#ad-pocket')) $('#ad-pocket').onclick = async () => {
    $('#ad-pocket-status').textContent = 'Regenerating…';
    try {
      const j = await (await fetch('/api/pocket', { method: 'POST' })).json();
      $('#ad-pocket-status').textContent = j.ok ? `✓ Rebuilt (${j.kb} KB) — re-AirDrop it to your iPhone.` : 'Failed: ' + (j.error || 'unknown');
    } catch (e) { $('#ad-pocket-status').textContent = 'Error: ' + e.message; }
  };
}

/* ================= EBAY LISTING COMPOSER ================= */
function ebayTitle(c) {
  // eBay max 80 chars — lead with the most-searched terms, no filler
  const bits = ['Pokémon', c.name];
  if (c.number) bits.push('#' + c.number);
  bits.push(c.set);
  if (c.setYear) bits.push(String(c.setYear));
  if (c.lang === 'ja') bits.push('Japanese');
  bits.push(c.graded ? `${c.grader || 'PSA'} ${c.grade || ''}`.trim() : 'NM');
  bits.push('TCG');
  let t = bits.join(' ');
  while (t.length > 80 && bits.length > 3) { bits.splice(bits.length - 2, 1); t = bits.join(' '); }
  return t.slice(0, 80);
}
function ebayDescription(c) {
  const pre = pregradeAll()[c.pcId];
  const cond = c.graded
    ? `Professionally graded ${c.grader || 'PSA'} ${c.grade || ''} — the slab in the photos is the exact item you receive.`
    : `Raw / ungraded, ${(c.wear || '').toLowerCase() === 'normal wear' ? 'near mint' : (c.wear || 'near mint').toLowerCase()} condition — please judge from the photos of the actual card.${pre ? ` Owner pre-screened under grading-bench lighting; centering and surface support roughly PSA ${pre.est} (opinion, not a guarantee).` : ''}`;
  return [
    `${c.name}${c.number ? ' #' + c.number : ''} — ${c.set}${c.setYear ? ' (' + c.setYear + ')' : ''}`,
    '',
    `• Set: ${c.set}`,
    `• Card number: ${c.number || '—'}`,
    `• Language: ${c.lang === 'ja' ? 'Japanese' : 'English'}`,
    `• Condition: ${c.graded ? `${c.grader || 'PSA'} ${c.grade || ''}` : (c.wear || 'Near Mint')}`,
    c.setYear ? `• Year: ${c.setYear}` : null,
    '',
    cond,
    '',
    'Shipping & care: ships in a fresh penny sleeve inside a semi-rigid holder (Card Saver), in a bubble mailer with tracking — packed the same way cards are prepped for PSA submission.',
    '',
    'From a smoke-free collection. Check my other listings — happy to combine shipping.',
  ].filter(x => x !== null).join('\n');
}
const VENUES = {
  ebay: { name: 'eBay', fee: 0.136, feeLabel: 'after ~13.6% fees',
    launch: (t) => 'https://www.ebay.com/sl/prelist/suggest?q=' + enc(t), launchLabel: '📤 Open eBay — title auto-copied' },
  fb: { name: 'Facebook Marketplace', fee: 0, feeLabel: 'local cash — you keep 100% (shipped = 10% fee)',
    launch: () => 'https://www.facebook.com/marketplace/create/item', launchLabel: '📤 Open FB Marketplace — copy goes with you' },
};
function localVenueStripHTML(c) {
  const q = enc('pokemon ' + (c.name || '') + (c.number ? ' ' + c.number : ''));
  const area = (State.venues && State.venues.local && State.venues.local.area) || 'Colorado Springs';
  return `<div class="subhead">Sell local — ${esc(area)} · keep 100%</div>
    <div class="sr-links">
      <a class="minilink" href="https://www.facebook.com/marketplace/search?query=${q}" target="_blank" rel="noopener">FB Marketplace</a>
      <a class="minilink" href="https://offerup.com/search?q=${q}" target="_blank" rel="noopener">OfferUp</a>
      <a class="minilink" href="https://www.mercari.com/search/?keyword=${q}&shippingPayerId=2" target="_blank" rel="noopener">Mercari (local)</a>
      <a class="minilink" href="https://cosprings.craigslist.org/search/sss?query=${q}" target="_blank" rel="noopener">Craigslist</a>
    </div>
    <p class="reason" style="margin-top:4px">Local cash = <b style="color:var(--green)">you keep 100%</b> (no fees, no shipping). Card shops that buy, COS/Denver Pokémon groups, shows &amp; safe-meetup spots are in the <b>Seller Playbook</b> (Sell &amp; Grade Guide tab).</p>`;
}
function openListingComposer(c, backTo, venueKey) {
  // Facebook (0% local) is the default — keeping 100% beats eBay on most cards.
  const venue = VENUES[venueKey] ? venueKey : (VENUES[State.lastVenue] ? State.lastVenue : 'fb');
  State.lastVenue = venue;
  const V = VENUES[venue];
  const mkt = c.price || 0;
  const title = ebayTitle(c);
  const desc = ebayDescription(c) + (venue === 'fb'
    ? '\n\nLocal pickup preferred — cash or tap-to-pay at a public safe-exchange spot. Can ship at buyer’s cost, tracked & insured.'
    : '');
  const net = (p) => p * (1 - V.fee);
  const aiOn = !!(State.live && State.live.ai && State.live.ai.enabled);
  const html = `<div class="modal-bg" id="modalBg"><div class="modal" style="max-width:760px">
    <button class="close-x" id="modalClose">×</button>
    <div class="modal-body" style="padding:26px">
      <h2 style="font-size:20px;margin-bottom:6px">📤 List for sale</h2>
      <div class="seg" style="display:inline-flex;margin-bottom:8px">
        <button id="lc-v-fb" class="${venue === 'fb' ? 'active' : ''}">⭐ Facebook · 0% local</button>
        <button id="lc-v-ebay" class="${venue === 'ebay' ? 'active' : ''}">eBay</button>
      </div>
      <p class="muted" style="font-size:12.5px;margin-bottom:14px">${esc(c.name)}${c.number ? ' #' + esc(c.number) : ''} · ${esc(c.set)} — copy what you need, then launch ${esc(V.name)} with the title ready to paste.${venue === 'fb' ? ' <b style="color:var(--green)">Local sales keep 100%</b> — shops, groups &amp; safe-meetup spots in the Seller Playbook.' : ''}</p>

      <div class="subhead">Title <span style="text-transform:none;letter-spacing:0">(<span id="lc-count">${title.length}</span>/80)</span></div>
      <div style="display:flex;gap:8px"><input id="lc-title" class="s-inp" style="margin:0" value="${esc(title)}" maxlength="80">
        <button class="btn sm" id="lc-copy-title">Copy</button></div>

      <div class="subhead">Price — check the comps, then pick</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn sm lc-price" data-p="${mkt.toFixed(2)}">Market ${money(mkt)}</button>
        <button class="btn sm lc-price" data-p="${(mkt * 0.9).toFixed(2)}">Fast sale ${money(mkt * 0.9)}</button>
        <button class="btn sm lc-price" data-p="${(mkt * 1.1).toFixed(2)}">Patient ${money(mkt * 1.1)}</button>
        <input id="lc-price" type="number" step="0.01" min="0" value="${mkt.toFixed(2)}" class="s-inp" style="width:110px;margin:0">
        <span class="reason" id="lc-net">nets ≈ ${money(net(mkt))} ${esc(V.feeLabel)}</span>
      </div>
      <div class="sr-links" style="margin-top:6px">
        <a class="minilink" href="${State.intel.urlTemplates.ebayRawSold.replace('{q}', enc(c.q))}" target="_blank" rel="noopener">Top solds (raw)</a>
        <a class="minilink" href="${gradeSoldLink(c, c.graded ? gradeKeyword(c) : 'PSA 10')}" target="_blank" rel="noopener">Top solds (${c.graded ? esc(gradeKeyword(c)) : 'PSA 10'})</a>
        <a class="minilink" href="${State.intel.urlTemplates.onetwentypoint.replace('{q}', enc(c.q))}" target="_blank" rel="noopener">130point</a>
        <a class="minilink" href="https://www.facebook.com/marketplace/search?query=${enc(c.q)}" target="_blank" rel="noopener">FB asking prices</a>
      </div>

      ${localVenueStripHTML(c)}

      <div class="subhead">Photos <span style="text-transform:none;letter-spacing:0">— reference fast, then shoot the real thing</span></div>
      <div style="display:flex;gap:14px;align-items:flex-start">
        ${c.img ? `<img src="${c.img}" style="width:72px;border-radius:6px">` : ''}
        <div class="reason" style="flex:1">Pull a reference instantly, then take <b>your own photos</b> (raw singles legally need a shot of the actual card — using others’ web images breaks policy &amp; copyright). GradeStage shot list: <b>1</b> front · <b>2</b> back · <b>3</b> corners · <b>4</b> surface under raking light · <b>5</b> any flaw.
        </div>
      </div>
      <div class="sr-links" style="margin-top:8px">
        <a class="minilink" href="https://www.google.com/search?tbm=isch&q=${enc((c.fullName || c.name) + ' ' + c.set + ' pokemon card')}" target="_blank" rel="noopener">🔍 Google Images</a>
        <a class="minilink" href="${gradeSoldLink(c, c.graded ? gradeKeyword(c) : 'PSA 10')}" target="_blank" rel="noopener">📷 How others shot it (eBay)</a>
        ${c.img ? `<a class="minilink" href="${c.img}" target="_blank" rel="noopener">Catalog art ↗</a>` : ''}
        ${c.img && State.live ? `<button class="minilink" id="lc-saveimg" style="cursor:pointer">💾 Save reference image</button>` : ''}
        <span class="reason" id="lc-imgstatus"></span>
      </div>

      <div class="subhead">Description ${aiOn ? '<button class="btn sm gold" id="lc-ai" style="margin-left:8px">✨ AI polish</button>' : ''}</div>
      <textarea id="lc-desc" class="s-inp" style="min-height:200px;font-size:12.5px;line-height:1.5">${esc(desc)}</textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn sm gold" id="lc-copy-all">📋 Copy everything</button>
        <button class="btn sm" id="lc-copy-desc">Copy description</button>
        <button class="btn primary" id="lc-launch">${esc(V.launchLabel)}</button>
        ${backTo ? '<button class="btn ghost sm" id="lc-back">← Back to card</button>' : ''}
      </div>
      <p class="reason" id="lc-status" style="margin-top:8px">Launching marks this card “For sale” and saves a listing note.</p>
    </div></div></div>`;
  $('#modalRoot').innerHTML = html;
  const T = () => $('#lc-title').value;
  const P = () => +($('#lc-price').value || 0);
  $('#lc-title').oninput = () => { $('#lc-count').textContent = T().length; };
  const setPrice = (v) => { $('#lc-price').value = (+v).toFixed(2); $('#lc-net').textContent = `nets ≈ ${money(net(+v))} ${V.feeLabel}`; };
  $$('.lc-price').forEach(b => b.onclick = () => setPrice(+b.dataset.p));
  $('#lc-price').oninput = () => $('#lc-net').textContent = `nets ≈ ${money(net(P()))} ${V.feeLabel}`;
  $('#lc-v-ebay').onclick = () => { if (venue !== 'ebay') openListingComposer(c, backTo, 'ebay'); };
  $('#lc-v-fb').onclick = () => { if (venue !== 'fb') openListingComposer(c, backTo, 'fb'); };
  const copy = async (txt, msg) => { try { await navigator.clipboard.writeText(txt); toast(msg); } catch { toast('Copy blocked — select & copy manually.'); } };
  $('#lc-copy-title').onclick = () => copy(T(), 'Title copied.');
  $('#lc-copy-desc').onclick = () => copy($('#lc-desc').value, 'Description copied.');
  $('#lc-copy-all').onclick = () => copy(`${T()}\n\nPrice: ${money(P())}\n\n${$('#lc-desc').value}`, 'Title + price + description copied.');
  if ($('#lc-saveimg')) $('#lc-saveimg').onclick = async () => {
    $('#lc-imgstatus').textContent = 'Saving…';
    try {
      const j = await (await fetch('/api/saveimg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: c.img, name: (c.fullName || c.name) + (c.number ? ' ' + c.number : '') + ' ' + c.set }) })).json();
      $('#lc-imgstatus').innerHTML = j.ok ? `✓ saved to <b>listing-photos/</b> (${j.kb} KB) — your reference shot` : '✕ ' + esc(j.error || 'failed');
    } catch (e) { $('#lc-imgstatus').textContent = 'Error: ' + e.message; }
  };
  if ($('#lc-ai')) $('#lc-ai').onclick = async () => {
    $('#lc-status').textContent = 'Asking the AI for polished copy…';
    try {
      const j = await (await fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        mode: 'listing', name: c.fullName, set: c.set, number: c.number, year: c.setYear,
        language: c.lang === 'ja' ? 'Japanese' : 'English', graded: c.graded, grader: c.grader, grade: c.grade,
        condition: c.graded ? `${c.grader} ${c.grade}` : (c.wear || 'Near Mint'), askingPrice: P(),
        preGrade: pregradeAll()[c.pcId] ? `owner pre-screen suggests ~PSA ${pregradeAll()[c.pcId].est}` : null }) })).json();
      if (j.ok && j.text) {
        const parts = j.text.split(/\n-{3,}\n/);
        if (parts.length >= 2) { const t = parts[0].trim().slice(0, 80); $('#lc-title').value = t; $('#lc-count').textContent = t.length; $('#lc-desc').value = parts.slice(1).join('\n---\n').trim(); }
        else $('#lc-desc').value = j.text.trim();
        $('#lc-status').textContent = `✨ Polished by ${j.model}.`;
      } else $('#lc-status').textContent = 'AI: ' + (j.error || 'no response');
    } catch (e) { $('#lc-status').textContent = 'AI error: ' + e.message; }
  };
  $('#lc-launch').onclick = async () => {
    // FB's create form has no URL prefill — copy title AND description together so
    // one paste fills the title and the rest drops into the description box.
    await copy(venue === 'fb' ? `${T()}\n\n${$('#lc-desc').value}` : T(),
      venue === 'fb' ? 'Title + description copied — paste into the FB form.' : 'Title copied — paste anywhere eBay asks.');
    uset(c, { status: 'forsale', note: ((uget(c).note || '') + `\n[${new Date().toISOString().slice(0, 10)}] ${V.name} draft @ ${money(P())} — "${T()}"`).trim() });
    window.open(V.launch(T()), '_blank', 'noopener');
    $('#lc-status').textContent = `✓ ${V.name} opened in your browser · card marked “For sale” · listing note saved.`;
    refreshAfterUser();
  };
  $('#modalClose').onclick = closeModal;
  $('#modalBg').onclick = e => { if (e.target.id === 'modalBg') closeModal(); };
  if (backTo) $('#lc-back').onclick = () => openModal(c);
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
          <button class="btn primary sm" id="mk-list">📤 List for sale</button>
          <button class="btn ${caseGet(c) ? 'gold' : ''} sm" id="mk-case">${caseGet(c) ? '★ In case' : '★ Display Case'}</button>
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
      ${!c.graded && c.game === 'Pokémon' && a.lad ? `
      <div class="subhead">Grade ladder <span style="text-transform:none;letter-spacing:0">— estimates; each links to that grade’s real eBay solds</span></div>
      <div class="ladder">
        <a class="lad-cell" href="${links(c)[1] ? links(c)[1].u : '#'}" target="_blank" rel="noopener"><span class="lc-g">Raw</span><span class="lc-v">${money(c.price)}</span></a>
        <a class="lad-cell g10" href="${gradeSoldLink(c, 'PSA 10')}" target="_blank" rel="noopener"><span class="lc-g">PSA 10</span><span class="lc-v">${money(a.lad.psa10)}</span></a>
        <a class="lad-cell g9" href="${gradeSoldLink(c, 'PSA 9')}" target="_blank" rel="noopener"><span class="lc-g">PSA 9</span><span class="lc-v">${money(a.lad.psa9)}</span></a>
        <a class="lad-cell g8" href="${gradeSoldLink(c, 'PSA 8')}" target="_blank" rel="noopener"><span class="lc-g">PSA 8</span><span class="lc-v">${money(a.lad.psa8)}</span></a>
        ${(gradeIntel().serviceDeltas || []).slice(0, 2).map(sd => `<a class="lad-cell svc" href="${gradeSoldLink(c, sd.service + ' 10')}" target="_blank" rel="noopener" title="${esc(sd.note)}"><span class="lc-g">${esc(sd.service)} 10</span><span class="lc-v">${money(a.lad.services[sd.service] ? a.lad.services[sd.service].v : 0)}</span></a>`).join('')}
      </div>` : ''}

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
  $('#mk-list').onclick = () => openListingComposer(c, true);
  $('#mk-case').onclick = () => openCasePicker(c);
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
      <input id="s-ai-model" class="s-inp" type="text" placeholder="Model (default claude-sonnet-4-6 / gpt-4o)" />
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
      ourGradeRead: a.title, estPsa10: a.estPsa10, netAfterFees: s.net,
      gradingCostAllIn: (State.intel.thresholds && State.intel.thresholds.allInGradingCost) || 35 };
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
