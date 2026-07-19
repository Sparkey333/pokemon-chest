#!/usr/bin/env python3
"""
Build the Pokémon Den "Pocket Edition" — a single self-contained .html file
you can AirDrop to your iPhone, open in Safari, and "Add to Home Screen" so it
looks and launches like an app. Everything (your collection, game plan, prices,
comp links) is inlined — no server, no internet needed except the comp links you
tap. It's a read/glance + list-helper companion to the full Mac app.

Run:  python3 scripts/build_pocket.py      (or it's regenerated on data refresh)
Output: "Pokémon Den — Pocket.html" in the project folder.
"""
import os, json, base64, re, datetime, html

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HOME = os.path.abspath(os.environ.get("POKECHEST_HOME") or ROOT)

def load(name, default=None):
    for base in (HOME, ROOT):
        p = os.path.join(base, "data", name)
        if os.path.isfile(p):
            try:
                return json.load(open(p, encoding="utf-8"))
            except Exception:
                pass
    return default

col = load("collection.json")
if not col:
    raise SystemExit("No data/collection.json — run build_data.py first.")
intel = load("selling-intel.json", {})
gintel = load("grade-intel.json", {})
plan = load("game-plan.json", {})
meta = col["meta"]
cards = col["cards"]
tmpl = (intel or {}).get("urlTemplates", {})

# ---- per-card derived fields (precomputed so the phone does zero work) -------
def ebay_title(c):
    bits = ["Pokémon", c["name"]]
    if c.get("number"):
        bits.append("#" + str(c["number"]))
    bits.append(c["set"])
    if c.get("setYear"):
        bits.append(str(c["setYear"]))
    if c.get("lang") == "ja":
        bits.append("Japanese")
    bits.append((f"{c.get('grader') or 'PSA'} {c.get('grade') or ''}".strip()) if c.get("graded") else "NM")
    bits.append("TCG")
    t = " ".join(bits)
    while len(t) > 80 and len(bits) > 3:
        bits.pop(-2)
        t = " ".join(bits)
    return t[:80]

def grade_kw(c):
    if c.get("graded") and c.get("grader") and c.get("grade"):
        return f"{c['grader']} {c['grade']}"
    return "PSA 10"

def url(t, q, grade=None):
    if not t:
        return None
    from urllib.parse import quote
    u = t.replace("{q}", quote(q or ""))
    if grade is not None:
        u = u.replace("{grade}", quote(grade))
    return u

def era_ratio(c):
    gr = (gintel or {}).get("gradeRatios", {})
    key = "vintage" if c.get("era") == "vintage" else "retro" if c.get("era") == "retro" else "modern"
    key = "mid" if key == "retro" else key
    r = gr.get(key) or gr.get("modern")
    if c.get("lang") == "ja" and key == "modern" and gr.get("modernJa"):
        r = gr["modernJa"]
    return r

slim = []
for c in cards:
    q = c.get("q", "")
    r = era_ratio(c) if not c.get("graded") else None
    psa10 = round((c.get("price") or 0) * r["psa10OfRaw"], 2) if r else None
    slim.append({
        "i": c["i"], "name": c["name"], "set": c["set"], "number": c.get("number"),
        "lang": c["lang"], "graded": c.get("graded", False), "grader": c.get("grader"),
        "grade": c.get("grade"), "era": c.get("era"), "price": c.get("price"),
        "value": c.get("value"), "pl": c.get("pl"), "plPct": c.get("plPct"),
        "img": c.get("img"), "game": c.get("game"), "title": ebay_title(c),
        "psa10": psa10,
        "u": {
            "eRaw": url(tmpl.get("ebayRawSold"), q),
            "eGr": url(tmpl.get("ebayGradedSold"), q, grade_kw(c)),
            "tcg": url(tmpl.get("tcgplayerJp") if c["lang"] == "ja" else tmpl.get("tcgplayerEn"), q),
            "pc": c.get("pcUrl"),
            "fb": "https://www.facebook.com/marketplace/search?query=" + __import__("urllib.parse", fromlist=["quote"]).quote((("Japanese " if c["lang"] == "ja" else "") + (c.get("name") or "")).strip()),
            "create_ebay": "https://www.ebay.com/sl/prelist/suggest?q=" + __import__("urllib.parse", fromlist=["quote"]).quote(ebay_title(c)),
            "create_fb": "https://www.facebook.com/marketplace/create/item",
        },
    })

# ---- "Now" money moves, precomputed -----------------------------------------
allin = ((intel or {}).get("thresholds", {}) or {}).get("allInGradingCost", 35)
raw_pk = [c for c in slim if not c["graded"] and c["game"] == "Pokémon"]
moves = []
# top grade upside
gc = sorted(
    [c for c in raw_pk if c["psa10"] and c["price"] and c["psa10"] * 0.864 - allin - c["price"] > max(40, c["price"] * 0.5)],
    key=lambda c: (c["psa10"] * 0.864 - allin - c["price"]), reverse=True)
if gc:
    g = gc[0]
    up = round(g["psa10"] * 0.864 - allin - g["price"])
    moves.append({"ic": "🔬", "t": f"Grade {g['name']}{(' #' + str(g['number'])) if g['number'] else ''}",
                  "d": f"PSA 10 ≈ ${g['psa10']:,.0f} vs ${g['price']:,.0f} raw — about ${up:,} upside. {len(gc)} strong candidates total.",
                  "card": g["i"]})
# top cash-in
sn = sorted([c for c in raw_pk if (c["value"] or 0) >= 40], key=lambda c: c["value"], reverse=True)
if sn:
    s = sn[0]
    moves.append({"ic": "💸", "t": f"Cash in {s['name']}{(' #' + str(s['number'])) if s['number'] else ''}",
                  "d": f"Top mover at ${s['value']:,.0f} — nets ≈ ${s['value']*0.864:,.0f} after fees. Tap for comps & to list.",
                  "card": s["i"]})
# best % flip
fl = sorted([c for c in raw_pk if c["plPct"] and (c["value"] or 0) >= 25], key=lambda c: c["plPct"], reverse=True)
if fl and fl[0]["plPct"] > 100:
    f = fl[0]
    mult = (f["value"] / f["price"]) if f.get("price") else 0
    gain = f"${f['pl']:,.0f} ({mult:.0f}×)" if f["plPct"] > 1000 else f"{f['plPct']:.0f}%"
    moves.append({"ic": "📈", "t": f"Lock the {gain} gain on {f['name']}",
                  "d": f"Worth ${f['value']:,.0f} — strongest return in your collection.", "card": f["i"]})
moves.append({"ic": "🔎", "t": "Pop-check before grading",
              "d": "High PSA-10 populations erase the grading premium — verify pop on your top cards on the Mac app’s Pop Watch before paying to slab.", "card": None})

top_sellers = sorted(slim, key=lambda c: c["value"] or 0, reverse=True)[:25]

DATA = {"meta": meta, "cards": slim, "moves": moves, "topSellers": [c["i"] for c in top_sellers],
        "plan": plan, "generated": datetime.datetime.now().strftime("%Y-%m-%d")}

# ---- icon (base64) ----------------------------------------------------------
icon_uri = ""
icon_path = os.path.join(ROOT, "src-tauri", "icons", "128x128@2x.png")
if not os.path.isfile(icon_path):
    icon_path = os.path.join(ROOT, "icon-source.png")
if os.path.isfile(icon_path):
    icon_uri = "data:image/png;base64," + base64.b64encode(open(icon_path, "rb").read()).decode()

OUT = os.path.join(HOME, "Pokémon Den — Pocket.html")
DATA_JSON = json.dumps(DATA, ensure_ascii=False, separators=(",", ":"))

HTML = """<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1">
<title>Pokémon Den — Pocket</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Chest">
<meta name="theme-color" content="#0a0e16">
<link rel="apple-touch-icon" href="__ICON__">
<link rel="icon" href="__ICON__">
<style>
:root{--bg:#0a0e16;--panel:#141c2b;--panel2:#192335;--bd:#26334b;--bd2:#324360;--tx:#e8eef8;--mut:#93a3be;--mut2:#6c7c98;--gold:#ffce4d;--acc:#4cc2ff;--grn:#3ad6a0;--red:#ff7a7a;--jp:#ff6b8a;--en:#6ba8ff}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 -apple-system,system-ui,'Segoe UI',sans-serif;padding-bottom:84px}
a{color:var(--acc);text-decoration:none}
.top{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,rgba(10,14,22,.97),rgba(10,14,22,.85));backdrop-filter:blur(10px);border-bottom:1px solid var(--bd);padding:max(10px,env(safe-area-inset-top)) 14px 10px;display:flex;align-items:center;gap:10px}
.top img{width:30px;height:30px;border-radius:7px}
.top h1{font-size:17px;margin:0}.top h1 span{color:var(--gold)}
.top .val{margin-left:auto;text-align:right}.top .val b{color:var(--gold);font-size:17px}.top .val small{display:block;color:var(--mut2);font-size:10px;text-transform:uppercase;letter-spacing:.1em}
main{padding:14px;max-width:680px;margin:0 auto}
.view{display:none}.view.on{display:block}
.kpis{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
.kpi{background:linear-gradient(160deg,var(--panel2),var(--panel));border:1px solid var(--bd);border-radius:12px;padding:11px}
.kpi b{display:block;font-size:18px;font-weight:800}.kpi small{color:var(--mut2);font-size:10px;text-transform:uppercase;letter-spacing:.08em}
.kpi.g b{color:var(--gold)}.kpi.gr b{color:var(--grn)}
.sec{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:var(--mut2);margin:18px 0 8px;font-weight:700}
.card-p{background:var(--panel);border:1px solid var(--bd);border-radius:13px;padding:14px;margin-bottom:12px}
.move{background:var(--panel2);border:1px solid var(--bd);border-radius:11px;padding:11px;margin-bottom:8px}
.move b{font-size:14px}.move .d{color:var(--mut);font-size:12.5px;margin-top:3px}
.chip{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:7px;background:var(--panel2);border:1px solid var(--bd2);color:var(--gold);margin:0 5px 5px 0}
.bul{margin:6px 0;padding-left:18px;color:var(--mut);font-size:13px}.bul li{margin-bottom:4px}
.bul b{color:var(--tx)}
input.search{width:100%;padding:12px 14px;border-radius:999px;border:1px solid var(--bd2);background:var(--panel);color:var(--tx);font-size:15px;margin-bottom:12px}
.row{display:flex;gap:11px;align-items:center;background:var(--panel);border:1px solid var(--bd);border-radius:12px;padding:9px;margin-bottom:8px}
.row img,.row .ph{width:42px;height:59px;border-radius:5px;object-fit:cover;flex:0 0 auto;background:var(--panel2)}
.row .nm{font-size:13.5px;font-weight:650;line-height:1.25}
.row .st{font-size:11.5px;color:var(--mut2)}
.row .pr{margin-left:auto;text-align:right;flex:0 0 auto}
.row .pr b{color:var(--gold);font-variant-numeric:tabular-nums}
.row .pl{font-size:10.5px;font-weight:700}.up{color:var(--grn)}.dn{color:var(--red)}
.exp{padding:4px 2px 8px}
.lk{display:inline-block;font-size:12px;font-weight:600;padding:7px 11px;border-radius:9px;background:var(--panel2);border:1px solid var(--bd2);margin:0 6px 6px 0;color:var(--tx)}
.lk.go{background:linear-gradient(135deg,var(--gold),#e7af2c);color:#1e1603;border-color:transparent}
.flag{font-size:10px;font-weight:800;padding:1px 6px;border-radius:6px}
.flag.en{color:var(--en)}.flag.jp{color:var(--jp)}
.tabs{position:fixed;bottom:0;left:0;right:0;z-index:6;display:flex;background:rgba(15,20,30,.96);backdrop-filter:blur(12px);border-top:1px solid var(--bd);padding-bottom:env(safe-area-inset-bottom)}
.tabs button{flex:1;background:none;border:none;color:var(--mut2);font:inherit;font-size:11px;padding:10px 0 12px;display:flex;flex-direction:column;align-items:center;gap:3px}
.tabs button .ic{font-size:19px}
.tabs button.on{color:var(--gold)}
.rec{border:1px solid var(--bd2);border-radius:11px;padding:11px 13px;margin:8px 0;font-size:13px;line-height:1.5}
.rec.g{background:linear-gradient(135deg,rgba(255,206,77,.1),transparent)}
.note{color:var(--mut2);font-size:11.5px;margin-top:8px}
.hd{font-size:13px;color:var(--mut)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
td{padding:6px 8px;border-bottom:1px solid var(--bd);vertical-align:top}
td b{color:var(--gold)}
</style></head><body>
<div class="top"><img src="__ICON__" alt=""><h1>Pokémon <span>Chest</span></h1>
  <div class="val"><small>Portfolio</small><b id="pv"></b></div></div>
<main>
  <section id="v-plan" class="view on"></section>
  <section id="v-cards" class="view"></section>
  <section id="v-sell" class="view"></section>
</main>
<nav class="tabs">
  <button data-v="plan" class="on"><span class="ic">🎯</span>Game Plan</button>
  <button data-v="cards"><span class="ic">🗂</span>Collection</button>
  <button data-v="sell"><span class="ic">💸</span>Sell</button>
</nav>
<script>
const D=__DATA__;
const byI={};D.cards.forEach(c=>byI[c.i]=c);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const money=(n,d=0)=>n==null?'—':'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ph='<div class="ph"></div>';
function thumb(c){return c.img?`<img src="${c.img}" loading="lazy" onerror="this.outerHTML='${ph}'">`:ph}
function plBadge(c){if(c.pl==null)return'';const u=c.pl>=0;return `<div class="pl ${u?'up':'dn'}">${u?'▲':'▼'} ${money(Math.abs(c.pl))}</div>`}
async function copy(t,el){try{await navigator.clipboard.writeText(t);if(el){const o=el.textContent;el.textContent='✓ copied';setTimeout(()=>el.textContent=o,1200)}}catch(e){alert('Copy: \\n\\n'+t)}}

function rowHTML(c){return `<div class="row" data-i="${c.i}">${thumb(c)}
  <div style="min-width:0;flex:1"><div class="nm">${esc(c.name)} ${c.graded?`<span class="chip" style="margin:0">${esc(c.grader||'')} ${c.grade||''}</span>`:''}</div>
  <div class="st"><span class="flag ${c.lang}">${c.lang==='ja'?'JP':'EN'}</span> ${esc(c.set)}${c.number?' · #'+esc(c.number):''}</div></div>
  <div class="pr"><b>${money(c.price)}</b>${plBadge(c)}</div></div>
  <div class="exp" id="exp-${c.i}" style="display:none"></div>`}
function expHTML(c){const u=c.u;return `
  ${c.psa10?`<div class="hd" style="margin:2px 0 8px">PSA 10 est. <b style="color:var(--gold)">${money(c.psa10)}</b> · PSA 9 ≈ ${money(Math.round(c.psa10*0.45))} · raw ${money(c.price)}</div>`:''}
  <div><span class="hd">Top sold comps:</span><br>
  ${u.eRaw?`<a class="lk" href="${u.eRaw}" target="_blank">eBay raw</a>`:''}
  ${u.eGr?`<a class="lk" href="${u.eGr}" target="_blank">eBay graded</a>`:''}
  ${u.tcg?`<a class="lk" href="${u.tcg}" target="_blank">TCGplayer</a>`:''}
  ${u.pc?`<a class="lk" href="${u.pc}" target="_blank">PriceCharting</a>`:''}
  ${u.fb?`<a class="lk" href="${u.fb}" target="_blank">FB prices</a>`:''}</div>
  <div style="margin-top:8px"><span class="hd">List it:</span><br>
  <a class="lk go" href="${u.create_ebay}" target="_blank" onclick="copy(${JSON.stringify(c.title).replace(/"/g,'&quot;')})">📤 eBay</a>
  <a class="lk" href="${u.create_fb}" target="_blank" onclick="copy(${JSON.stringify(c.title).replace(/"/g,'&quot;')})">📤 FB (0% local)</a>
  <span class="lk" onclick="copy(${JSON.stringify(c.title).replace(/"/g,'&quot;')},this)">Copy title</span></div>
  <div class="note">${esc(c.title)}</div>`}
function wireRows(scope){$$(scope+' .row').forEach(r=>r.onclick=()=>{const e=$('#exp-'+r.dataset.i);if(!e)return;if(e.style.display==='none'){e.innerHTML=expHTML(byI[r.dataset.i]);e.style.display='block'}else e.style.display='none'})}

function renderPlan(){const m=D.meta,p=D.plan||{};
  $('#v-plan').innerHTML=`
  <div class="kpis">
    <div class="kpi g"><b>${money(m.totalValue)}</b><small>Value</small></div>
    <div class="kpi gr"><b>${m.totalPL>=0?'+':''}${money(m.totalPL)}</b><small>Profit</small></div>
    <div class="kpi"><b>${m.totalCards.toLocaleString()}</b><small>Cards</small></div>
  </div>
  <div class="sec">🟢 Now — next best moves</div>
  ${D.moves.map(mv=>`<div class="move" ${mv.card!=null?`data-go="${mv.card}"`:''}><b>${mv.ic} ${esc(mv.t)}</b><div class="d">${esc(mv.d)}</div></div>`).join('')}
  ${p.llcConcept?`<div class="sec">🟡 Build — your LLC play</div>
    <div class="card-p"><div style="font-size:13px;color:var(--mut);margin-bottom:8px">${esc(p.llcConcept.pitch)}</div>
    ${(p.llcConcept.nameIdeas||[]).slice(0,3).map(n=>`<span class="chip">${esc(n)}</span>`).join('')}
    <div class="sec" style="margin-top:10px">Product lines</div>
    <ul class="bul">${(p.llcConcept.productLines||[]).slice(0,4).map(x=>`<li><b>${esc(x.name)}</b> — ${esc(x.what)}</li>`).join('')}</ul>
    <div class="rec g"><b>⚖ Stay legal:</b> ${esc((p.llcConcept.legalGuardrails||[''])[0])}</div></div>`:''}
  ${p.invest?`<div class="sec">🔵 Invest — smart next buys</div>
    <div class="card-p"><div style="font-size:13px;color:var(--mut);margin-bottom:8px">${esc(p.invest.thesis)}</div>
    <table><tbody>${(p.invest.buys||[]).slice(0,6).map(b=>`<tr><td><b>${esc(b.item)}</b><br><span style="color:var(--mut2)">${esc(b.why)}</span></td><td style="white-space:nowrap;text-align:right">${esc(b.range)}<br><span style="color:var(--mut2)">${esc(b.horizon)}</span></td></tr>`).join('')}</tbody></table></div>`:''}
  <p class="note">${esc((p.disclaimer)||'Snapshot generated '+D.generated+'. The full app on your Mac has live comps, AI, Grade Lab & more.')}</p>`;
  $$('#v-plan .move[data-go]').forEach(el=>el.onclick=()=>{go('cards');setTimeout(()=>{const e=$('#exp-'+el.dataset.go);const r=document.querySelector('#v-cards .row[data-i="'+el.dataset.go+'"]');if(r){r.scrollIntoView({block:'center'});if(e&&e.style.display==='none'){e.innerHTML=expHTML(byI[el.dataset.go]);e.style.display='block'}}},60)})}

function renderCards(filter){const f=(filter||'').toLowerCase();
  const list=D.cards.filter(c=>!f||(c.name+' '+c.set+' '+(c.number||'')).toLowerCase().includes(f)).sort((a,b)=>(b.value||0)-(a.value||0));
  $('#v-cards').innerHTML=`<input class="search" id="cs" placeholder="Search ${D.cards.length.toLocaleString()} cards…" value="${esc(filter||'')}">
    <div class="hd" style="margin-bottom:8px">${list.length.toLocaleString()} cards · ${money(list.reduce((s,c)=>s+(c.value||0),0))}</div>
    ${list.slice(0,300).map(rowHTML).join('')}
    ${list.length>300?'<p class="note">Showing top 300 by value — search to narrow.</p>':''}`;
  const cs=$('#cs');cs.oninput=()=>{const v=cs.value;clearTimeout(cs._t);cs._t=setTimeout(()=>{renderCards(v);$('#cs').focus()},180)};
  wireRows('#v-cards')}

function renderSell(){const top=D.topSellers.map(i=>byI[i]);
  $('#v-sell').innerHTML=`<div class="sec">Your 25 most valuable — tap for comps & to list</div>
    ${top.map(rowHTML).join('')}`;
  wireRows('#v-sell')}

function go(v){$$('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));$$('.view').forEach(s=>s.classList.toggle('on',s.id==='v-'+v));window.scrollTo(0,0)}
$$('.tabs button').forEach(b=>b.onclick=()=>go(b.dataset.v));
$('#pv').textContent=money(D.meta.totalValue);
renderPlan();renderCards();renderSell();
</script></body></html>"""

HTML = HTML.replace("__DATA__", DATA_JSON).replace("__ICON__", icon_uri)
with open(OUT, "w", encoding="utf-8") as f:
    f.write(HTML)
print(f"Wrote {OUT}  ({len(HTML)//1024} KB) · {len(slim)} cards · plan={'yes' if plan else 'pending'}")
