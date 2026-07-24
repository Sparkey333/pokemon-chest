/* ===================== Pokémon Chest — Scanner + Codex =====================
   Mac camera / Continuity Camera / iPhone phone-mode → identify & search the
   widest Pokémon TCG codex (TCGdex EN+JA) plus PriceCharting /api/products when
   a BYOK token is connected.
*/
'use strict';

const Scan = {
  cam: { stream: null, deviceId: null, mirror: false },
  staged: null,          // { dataUrl, guess?, guessLine? }
  selected: null,        // collection card or codex/PC hit
  lastQ: '',
  meta: null,
  hits: [],              // last rendered search hits (index → object)
};

function renderScan() {
  const el = $('#view-scan');
  if (!el) return;
  const live = !!State.live;
  const own = (State.meta && State.meta.totalEntries) || State.cards.length || 0;
  const cx = Scan.meta;
  el.innerHTML = `
  <div class="section-head"><div><h2>📷 Scanner</h2>
    <div class="sub">Point your Mac or iPhone at a card — search <b>every release set</b> in the local codex (EN + JA, including special / secret rares), and PriceCharting’s product catalog when your token is connected.</div></div>
    <div class="scan-meta" id="sc-meta">${cx ? `${(cx.cards || 0).toLocaleString()} codex cards · ${(cx.sets || 0).toLocaleString()} sets · ${(cx.specialCards || 0).toLocaleString()} specials` : 'loading codex…'}</div>
  </div>

  ${live ? '' : `<div class="panel scan-warn"><p class="muted">⚠ Launch via <b>start.command</b> (or the app) for camera, PriceCharting search, AI identify, and phone mode. Static open can still browse the bundled codex file if present.</p></div>`}

  <div class="scan-grid">
    <div class="panel scan-panel">
      <h3>1 · Search the codex</h3>
      <div class="scan-filters">
        <input id="sc-q" class="s-inp" type="search" placeholder="Name, set, number… e.g. Charizard 4 Base, Mewtwo 125, SAR" autocomplete="off" />
        <select id="sc-lang" class="s-inp" title="Language">
          <option value="all">EN + JA</option>
          <option value="en">English</option>
          <option value="ja">Japanese</option>
        </select>
        <label class="scan-check"><input type="checkbox" id="sc-special"> Special / secret only</label>
      </div>
      <div class="scan-scope">
        <span class="chip" id="sc-scope-own">Your chest · ${own.toLocaleString()}</span>
        <span class="chip gold" id="sc-scope-codex">TCGdex codex</span>
        <span class="chip ${State.live && State.live.priceCharting ? 'gold' : ''}" id="sc-scope-pc">PriceCharting ${State.live && State.live.priceCharting ? 'live' : 'needs token'}</span>
      </div>
      <div id="sc-results" class="sc-results"><p class="reason">Type a name or number — or snap a card and Identify.</p></div>
      <div id="sc-selected" class="sc-selected"></div>
    </div>

    <div class="panel scan-panel">
      <h3>2 · Frame &amp; snap</h3>
      <div class="sc-camwrap">
        <video id="sc-video" autoplay playsinline muted></video>
        <div class="sc-guide" aria-hidden="true"></div>
        <div id="sc-flash"></div>
        <div class="sc-cam-empty" id="sc-cam-empty">Camera off — Start, or use Continuity Camera (bring your iPhone nearby).</div>
      </div>
      <div class="scan-actions">
        <button class="btn primary" id="sc-start">🎥 Start camera</button>
        <button class="btn gold" id="sc-snap" disabled>📸 Capture</button>
        <select id="sc-device" class="s-inp" title="Camera — iPhone appears via Continuity Camera"></select>
        <label class="scan-check"><input type="checkbox" id="sc-mirror"> Mirror</label>
      </div>
      <div id="sc-staged"></div>
      <div class="scan-actions" style="margin-top:8px">
        <label class="btn sm" style="cursor:pointer">📱 Take / upload photo
          <input id="sc-file" type="file" accept="image/*" capture="environment" hidden></label>
        <button class="btn sm ghost" id="sc-rebuild" ${live ? '' : 'disabled'}>↻ Rebuild Codex</button>
      </div>
      <p class="reason" style="margin-top:8px">Mac: Continuity Camera lists your iPhone automatically. Or enable <b>Phone mode</b> below and open the LAN link on your iPhone (same Wi‑Fi).</p>
    </div>
  </div>

  <div class="scan-grid" style="margin-top:14px">
    <div class="panel scan-panel">
      <h3>📱 Phone mode — iPhone scan</h3>
      <p class="reason">Opens a LAN address so your iPhone (same Wi‑Fi) runs this Scanner. Uses a local HTTPS cert when possible so the live camera works on iOS.</p>
      <div id="sc-lan">${live ? '<p class="reason">Checking…</p>' : '<p class="reason">Needs the local server.</p>'}</div>
    </div>
    <div class="panel scan-panel">
      <h3>🔑 How matches work</h3>
      <ul class="scan-howto">
        <li><b>No keys:</b> search the local TCGdex codex (all EN+JA sets &amp; special rares) and your collection.</li>
        <li><b>PriceCharting token:</b> same <code>/api/products</code> catalog search their site uses — unique product ids + live ungraded prices.</li>
        <li><b>AI key:</b> 🔮 Identify reads the photo (name / number / set) then fills the search.</li>
      </ul>
      <p class="reason">Add keys in <button class="minilink" id="sc-open-live">⚙ Live</button>.</p>
    </div>
  </div>`;

  $('#sc-q').oninput = () => scRunSearch();
  $('#sc-lang').onchange = () => scRunSearch();
  $('#sc-special').onchange = () => scRunSearch();
  $('#sc-start').onclick = () => scCamStart();
  $('#sc-device').onchange = e => { Scan.cam.deviceId = e.target.value || null; if (Scan.cam.stream) scCamStart(); };
  $('#sc-mirror').onchange = e => {
    Scan.cam.mirror = e.target.checked;
    $('#sc-video').classList.toggle('mirror', Scan.cam.mirror);
  };
  $('#sc-snap').onclick = scCapture;
  $('#sc-file').onchange = async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const dataUrl = await scBlobToDataUrl(f);
    Scan.staged = { dataUrl };
    scRenderStaged();
    e.target.value = '';
  };
  if ($('#sc-rebuild')) $('#sc-rebuild').onclick = scRebuildCodex;
  if ($('#sc-open-live')) $('#sc-open-live').onclick = () => openSettings();

  scRenderStaged();
  if (Scan.selected) scSelect(Scan.selected);
  scLoadMeta();
  if (live) scRenderLan();
  if (live && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' })
      .then(p => { if (p.state === 'granted' && State.view === 'scan' && !Scan.cam.stream) scCamStart(); })
      .catch(() => {});
  }
}

async function scLoadMeta() {
  const box = $('#sc-meta');
  try {
    if (State.live) {
      const j = await (await fetch('/api/codex/meta', { cache: 'no-store' })).json();
      if (j.ok) {
        Scan.meta = j.meta || {};
        if (box) box.textContent = `${(Scan.meta.cards || 0).toLocaleString()} codex cards · ${(Scan.meta.sets || 0).toLocaleString()} sets · ${(Scan.meta.specialCards || 0).toLocaleString()} specials · ${j.generatedAt ? j.generatedAt.slice(0, 10) : ''}`;
        return;
      }
    }
    const d = await (await fetch('data/codex.json?_=' + Date.now())).json();
    Scan.meta = d.meta || {};
    if (box) box.textContent = `${(Scan.meta.cards || 0).toLocaleString()} codex cards · ${(Scan.meta.sets || 0).toLocaleString()} sets · ${(Scan.meta.specialCards || 0).toLocaleString()} specials`;
  } catch {
    if (box) box.textContent = 'Codex not loaded — click Rebuild Codex (server required).';
  }
}

async function scRebuildCodex() {
  if (!State.live) return toast('Launch via start.command to rebuild the codex.');
  const b = $('#sc-rebuild'); if (b) { b.disabled = true; b.textContent = 'Rebuilding…'; }
  toast('Rebuilding full EN+JA codex from TCGdex…');
  try {
    const j = await (await fetch('/api/codex/refresh', { method: 'POST' })).json();
    if (!j.ok) toast('Codex rebuild failed: ' + (j.error || 'unknown'));
    else {
      Scan.meta = j.report || {};
      toast(`Codex ready: ${(Scan.meta.cards || 0).toLocaleString()} cards · ${(Scan.meta.sets || 0).toLocaleString()} sets`);
      scLoadMeta();
      scRunSearch();
    }
  } catch (e) { toast('Codex error: ' + e.message); }
  if (b) { b.disabled = false; b.textContent = '↻ Rebuild Codex'; }
}

function scOwnHits(q, limit = 8) {
  const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  return State.cards.filter(c => {
    const hay = `${c.name} ${c.set} ${c.number || ''} ${c.fullName || ''} ${c.setId || ''}`.toLowerCase();
    return toks.every(t => hay.includes(t));
  }).slice(0, limit).map(c => Object.assign({}, c, { source: 'collection', inChest: true }));
}

async function scRunSearch() {
  const qEl = $('#sc-q');
  const results = $('#sc-results');
  if (!qEl || !results) return;
  const q = qEl.value.trim();
  Scan.lastQ = q;
  if (!q) {
    results.innerHTML = '<p class="reason">Type a name or number — or snap a card and Identify.</p>';
    return;
  }
  results.innerHTML = '<p class="reason">Searching…</p>';
  const lang = ($('#sc-lang') && $('#sc-lang').value) || 'all';
  const special = !!( $('#sc-special') && $('#sc-special').checked );
  const own = scOwnHits(q, 8);

  let codex = [], pc = [], err = null;
  try {
    if (State.live) {
      const params = new URLSearchParams({ q, limit: '24' });
      if (lang !== 'all') params.set('lang', lang);
      if (special) params.set('special', '1');
      const cj = await (await fetch('/api/codex?' + params, { cache: 'no-store' })).json();
      if (cj.ok) codex = cj.results || [];
      else err = cj.error;
      if (State.live.priceCharting) {
        const pj = await (await fetch('/api/products?q=' + enc(q), { cache: 'no-store' })).json();
        if (pj.ok) pc = pj.products || [];
        else if (pj.enabled === false) { /* token missing */ }
        else if (!err) err = pj.error;
      }
    } else {
      // Static fallback: filter a thin client slice if the big file is too heavy —
      // prefer server. We still try a lightweight fetch of meta only.
      codex = [];
    }
  } catch (e) { err = e.message; }

  if (Scan.lastQ !== q) return; // stale
  Scan.hits = [];
  const pushHit = (c) => {
    const hit = {
      source: c.source || (c.inChest ? 'collection' : 'codex'),
      i: c.i, pcId: c.pcId || (c.source === 'pricecharting' ? c.id : null),
      id: c.id, name: c.name, number: c.number,
      set: c.set, setId: c.setId, lang: c.lang, img: c.img, price: c.price,
      value: c.value, pcUrl: c.pcUrl, special: !!c.special,
      inChest: !!(c.inChest || c.source === 'collection'),
      fullName: c.fullName, q: c.q,
    };
    const idx = Scan.hits.length;
    Scan.hits.push(hit);
    return scResultBtn(hit, idx);
  };
  const blocks = [];
  if (own.length) {
    blocks.push(`<div class="sc-group"><div class="sc-ghead">In your chest</div>${own.map(pushHit).join('')}</div>`);
  }
  if (pc.length) {
    blocks.push(`<div class="sc-group"><div class="sc-ghead">PriceCharting catalog</div>${pc.map(pushHit).join('')}</div>`);
  }
  const filteredCodex = special ? codex.filter(c => c.special) : codex;
  if (filteredCodex.length) {
    blocks.push(`<div class="sc-group"><div class="sc-ghead">TCGdex release codex${lang !== 'all' ? ' · ' + lang.toUpperCase() : ''}</div>${filteredCodex.map(pushHit).join('')}</div>`);
  }
  if (!blocks.length) {
    results.innerHTML = `<p class="reason">${err ? 'Search error: ' + esc(err) : 'No matches — try the collector number + set, or rebuild the codex.'}</p>`;
    return;
  }
  results.innerHTML = blocks.join('');
  $$('.sc-res', results).forEach(b => {
    b.onclick = () => {
      const hit = Scan.hits[+b.dataset.idx];
      if (hit) scSelect(hit);
    };
  });
}

function scResultBtn(c, idx) {
  const num = c.number ? ' #' + esc(c.number) : '';
  const set = esc(c.set || '');
  const price = c.price != null ? money(c.price) : (c.value != null ? money(c.value) : '');
  const badge = c.inChest || c.source === 'collection' ? '<span class="sc-badge chest">chest</span>'
    : c.source === 'pricecharting' ? '<span class="sc-badge pc">PC</span>'
    : c.special ? '<span class="sc-badge special">special</span>'
    : '<span class="sc-badge codex">codex</span>';
  const lang = c.lang === 'ja' ? '🇯🇵' : (c.lang === 'en' ? '🇺🇸' : '');
  const thumb = c.img
    ? `<img class="sc-thumb" src="${esc(c.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<div class="sc-thumb ph">${esc((c.name || '?').slice(0, 1))}</div>`;
  return `<button class="sc-res" data-idx="${idx}">${thumb}<span class="sc-res-body"><b>${esc(c.name || '?')}${num}</b>${badge}<br><span class="reason">${set} ${lang} ${price ? '· ' + price : ''}</span></span></button>`;
}

function scSelect(c) {
  Scan.selected = c;
  if (Scan.staged && (c.inChest || c.source === 'collection') && c.pcId && State.live) {
    const d = Scan.staged.dataUrl;
    Scan.staged = null;
    scRenderStaged();
    scSaveToCard(c, d);
  }
  const box = $('#sc-selected');
  if (!box) return;
  const thumb = c.img
    ? `<img class="sc-thumb lg" src="${esc(c.img)}" alt="">`
    : `<div class="sc-thumb lg ph">${esc((c.name || '?').slice(0, 1))}</div>`;
  const links = [];
  if (c.inChest || c.source === 'collection') {
    const own = State.cards.find(x => x.pcId === c.pcId || x.i === c.i);
    if (own) links.push(`<button class="btn sm gold" id="sc-open-card">Open in chest</button>`);
  }
  if (c.pcUrl) links.push(`<a class="btn sm" href="${esc(c.pcUrl)}" target="_blank" rel="noopener">PriceCharting ↗</a>`);
  else if (c.pcId && /^\d+$/.test(String(c.pcId))) {
    links.push(`<a class="btn sm" href="https://www.pricecharting.com/game/${enc(c.pcId)}" target="_blank" rel="noopener">PriceCharting ↗</a>`);
  }
  const tcg = c.id ? `https://www.tcgdex.net/card/${enc(c.id)}` : null;
  if (tcg && c.source !== 'pricecharting') links.push(`<a class="btn sm ghost" href="${tcg}" target="_blank" rel="noopener">TCGdex ↗</a>`);
  // Deep-search PriceCharting by name when we only have a codex hit
  if (!c.pcUrl && c.name) {
    const pq = [c.name, c.number, c.set].filter(Boolean).join(' ');
    links.push(`<a class="btn sm ghost" href="https://www.pricecharting.com/search-products?q=${enc(pq)}&type=prices" target="_blank" rel="noopener">Find on PriceCharting</a>`);
  }
  box.innerHTML = `<div class="sc-sel-card">${thumb}<div>
    <b>${esc(c.name || '?')}${c.number ? ' <span class="reason">#' + esc(c.number) + '</span>' : ''}</b>
    ${c.special ? ' <span class="sc-badge special">special</span>' : ''}
    <br><span class="reason">${esc(c.set || '')}${c.lang ? ' · ' + (c.lang === 'ja' ? 'Japanese' : 'English') : ''}${c.price != null ? ' · ' + money(c.price) : ''}</span>
    <div class="scan-actions" style="margin-top:8px">${links.join('')}</div>
  </div></div>`;
  if ($('#sc-open-card')) {
    $('#sc-open-card').onclick = () => {
      const own = State.cards.find(x => x.pcId === c.pcId || x.i === c.i);
      if (own && typeof openModal === 'function') openModal(own);
    };
  }
}

function scRenderStaged() {
  const box = $('#sc-staged'); if (!box) return;
  const st = Scan.staged;
  if (!st) { box.innerHTML = ''; return; }
  const aiOn = State.live && State.live.ai && State.live.ai.enabled;
  box.innerHTML = `<div class="sc-stagedcard">
    <img src="${st.dataUrl}" alt="captured card">
    <div style="flex:1;min-width:0">
      <b>Captured — match it</b>
      <div class="reason" id="sc-guess">${st.guessLine || (aiOn ? 'Tap Identify to read the card, or type the name/number above.' : 'Type the name or collector number above (add an AI key in ⚙ Live for one-tap Identify).')}</div>
      <div class="scan-actions" style="margin-top:7px">
        ${aiOn ? `<button class="btn sm primary" id="sc-ident">🔮 Identify card</button>` : `<button class="btn sm" id="sc-ident-hint">How to identify</button>`}
        <button class="minilink" id="sc-discard">✕ discard</button>
      </div>
    </div></div>`;
  if ($('#sc-ident')) $('#sc-ident').onclick = scIdentify;
  if ($('#sc-ident-hint')) $('#sc-ident-hint').onclick = () => {
    toast('Connect a Claude or OpenAI key in ⚙ Live for photo Identify — or type the number from the card.');
    openSettings();
  };
  $('#sc-discard').onclick = () => { Scan.staged = null; scRenderStaged(); };
}

async function scIdentify() {
  const st = Scan.staged; if (!st) return;
  const g = $('#sc-guess'); if (g) g.textContent = 'Reading the card…';
  try {
    const j = await (await fetch('/api/ai/identify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: st.dataUrl }),
    })).json();
    if (j.enabled === false) {
      if (g) g.textContent = 'Add an AI key in ⚙ Live to identify from photos.';
      return;
    }
    if (!j.ok) { if (g) g.textContent = '✕ ' + (j.error || 'could not identify'); return; }
    st.guess = j.guess || {};
    const conf = st.guess.confidence != null ? ` · ${Math.round(st.guess.confidence * 100)}%` : '';
    st.guessLine = `Looks like: ${st.guess.name || '?'}${st.guess.number ? ' #' + st.guess.number : ''} · ${st.guess.set || 'set unknown'} · ${st.guess.lang === 'ja' ? '🇯🇵' : '🇺🇸'}${conf}`;
    const q = $('#sc-q');
    if (q && st.guess.name) {
      q.value = [st.guess.name, st.guess.number].filter(Boolean).join(' ');
      if (st.guess.lang && $('#sc-lang')) $('#sc-lang').value = st.guess.lang === 'ja' ? 'ja' : 'en';
      await scRunSearch();
      if (!$('.sc-res', $('#sc-results'))) {
        q.value = st.guess.name;
        await scRunSearch();
      }
    }
    scRenderStaged();
  } catch (e) { if (g) g.textContent = '✕ ' + e.message; }
}

async function scCamStart() {
  scCamStop();
  const video = $('#sc-video');
  const empty = $('#sc-cam-empty');
  try {
    const constraints = {
      audio: false,
      video: Scan.cam.deviceId
        ? { deviceId: { exact: Scan.cam.deviceId }, width: { ideal: 1920 } }
        : { facingMode: 'environment', width: { ideal: 1920 } },
    };
    Scan.cam.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = Scan.cam.stream;
    video.classList.toggle('mirror', Scan.cam.mirror);
    if (empty) empty.hidden = true;
    $('#sc-snap').disabled = false;
    $('#sc-start').textContent = '⏹ Stop camera';
    $('#sc-start').onclick = () => scCamStop();
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    $('#sc-device').innerHTML = devs.map((d, i) =>
      `<option value="${esc(d.deviceId)}"${d.deviceId === Scan.cam.deviceId ? ' selected' : ''}>${esc(d.label || ('Camera ' + (i + 1)))}</option>`
    ).join('');
    if (!Scan.cam.deviceId && devs[0]) Scan.cam.deviceId = devs[0].deviceId;
  } catch (e) {
    if (location.protocol === 'http:' && !/^(127\.|localhost)/.test(location.hostname))
      return toast('Live camera needs the HTTPS phone-mode link — or use Take/upload photo.');
    const msgs = {
      NotAllowedError: 'Camera permission denied — allow it in System Settings → Privacy & Security → Camera.',
      NotFoundError: 'No camera found — plug one in, or bring your iPhone nearby for Continuity Camera.',
      NotReadableError: 'Camera busy in another app — close Zoom/FaceTime and retry.',
      OverconstrainedError: 'That camera went away — pick another from the list.',
    };
    if (e.name === 'OverconstrainedError') Scan.cam.deviceId = null;
    toast(msgs[e.name] || ('Camera blocked: ' + e.message));
  }
}

function scCamStop() {
  if (Scan.cam.stream) { Scan.cam.stream.getTracks().forEach(t => t.stop()); Scan.cam.stream = null; }
  const v = $('#sc-video'); if (v) v.srcObject = null;
  const empty = $('#sc-cam-empty'); if (empty) empty.hidden = false;
  const snap = $('#sc-snap'); if (snap) snap.disabled = true;
  const st = $('#sc-start');
  if (st) { st.textContent = '🎥 Start camera'; st.onclick = () => scCamStart(); }
}

function scCapture() {
  const video = $('#sc-video');
  if (!Scan.cam.stream || !video.videoWidth) return toast('Start the camera first.');
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const cv = document.createElement('canvas');
  cv.width = Math.round(video.videoWidth * scale);
  cv.height = Math.round(video.videoHeight * scale);
  const ctx = cv.getContext('2d');
  if (Scan.cam.mirror) { ctx.translate(cv.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, cv.width, cv.height);
  const flash = $('#sc-flash');
  if (flash) { flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 220); }
  const dataUrl = cv.toDataURL('image/jpeg', 0.92);
  const sel = Scan.selected;
  if (sel && (sel.inChest || sel.source === 'collection') && sel.pcId && State.live) {
    return scSaveToCard(sel, dataUrl);
  }
  Scan.staged = { dataUrl };
  scRenderStaged();
}

async function scSaveToCard(c, dataUrl) {
  if (!State.live) return toast('Launch via start.command to save photos.');
  const pcId = c.pcId;
  if (!pcId) return toast('This hit has no PriceCharting id to file under.');
  try {
    // Find next free scan-N slot
    let slot = 'scan-1';
    try {
      const j = await (await fetch('/api/listingphotos?pcId=' + enc(pcId), { cache: 'no-store' })).json();
      const used = new Set(Object.keys((j && j.photos) || {}));
      let n = 1;
      while (used.has('scan-' + n)) n++;
      slot = 'scan-' + n;
    } catch { /* first shot */ }
    const j = await (await fetch('/api/listingphoto', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pcId, slot, dataUrl }),
    })).json();
    if (!j.ok) return toast('Save failed: ' + (j.error || 'unknown'));
    toast(`Saved ${slot} to ${c.name || 'card'}.`);
  } catch (e) { toast('Save error: ' + e.message); }
}

function scBlobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function scRenderLan() {
  const box = $('#sc-lan'); if (!box || !State.live) return;
  const paint = (j) => {
    if (!j || !j.ok) { box.innerHTML = `<p class="reason">Could not read LAN status.</p>`; return; }
    if (j.error && !j.enabled) {
      box.innerHTML = `<p class="reason" style="color:var(--red)">LAN error: ${esc(j.error)}</p>
        <button class="btn sm primary" id="sc-lan-on">Enable phone mode</button>`;
    } else if (j.enabled) {
      const urls = (j.urls || []).map(u => `<div class="sc-lan-url"><code>${esc(u)}</code>
        <button class="btn sm" data-copy="${esc(u)}">Copy</button>
        <a class="btn sm ghost" href="${esc(u)}" target="_blank" rel="noopener">Open</a></div>`).join('')
        || '<p class="reason">Enabled, but no private IP found.</p>';
      box.innerHTML = `<p class="reason">Phone mode on${j.tls ? ' · HTTPS' : ' · HTTP (use Take photo if camera is blocked)'} · port ${j.port}</p>
        ${urls}
        <button class="btn sm ghost" id="sc-lan-off" style="margin-top:8px">Turn off</button>`;
    } else {
      box.innerHTML = `<button class="btn sm primary" id="sc-lan-on">Enable phone mode</button>`;
    }
    if ($('#sc-lan-on')) $('#sc-lan-on').onclick = async () => {
      box.innerHTML = '<p class="reason">Starting…</p>';
      const r = await (await fetch('/api/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) })).json();
      paint(r);
    };
    if ($('#sc-lan-off')) $('#sc-lan-off').onclick = async () => {
      const r = await (await fetch('/api/lan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) })).json();
      paint(r);
    };
    $$('[data-copy]', box).forEach(b => b.onclick = async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied LAN URL'); }
      catch { toast(b.dataset.copy); }
    });
  };
  try { paint(await (await fetch('/api/lan', { cache: 'no-store' })).json()); }
  catch { box.innerHTML = '<p class="reason">LAN status unavailable.</p>'; }
}

// Stop the camera when leaving the Scanner tab.
const _scanSwitchView = typeof switchView === 'function' ? switchView : null;
window.scOnLeave = () => scCamStop();
