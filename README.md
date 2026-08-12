# Pokémon Chest 🔴⚪

A premium‑style **vault you own** (free from source / one‑time when purchased) for your
card collection — built from your PriceCharting export. English **and** Japanese, card art,
one‑click live sold‑comp links, and (optionally, bring‑your‑own‑key) live price data and
AI recommendations. Runs 100% locally on your Mac: no accounts, no subscriptions, and
every core feature works with **no API keys at all**.

> Think PriceCharting *Premium* + a sell/grade advisor, but it's yours and it's free.

---

## Run it

**Easiest:** double‑click **`start.command`**. It launches a tiny local server
(`server.py`, Python stdlib only) and opens Pokémon Chest in your browser at
`http://localhost:8787`. Keep the little Terminal window open while you browse; close it
(or Ctrl‑C) to stop. First time, macOS may ask you to confirm — right‑click → Open, or
System Settings → Privacy & Security → "Open Anyway".

**Native app:** once built, open **`Pokémon Chest.app`** (or install from the `.dmg`) —
same app, no Terminal or browser needed. The Tauri shell in `src-tauri/` wraps the exact
same local server and UI.

**Download (macOS):** open **[`GET-POKEMON-CHEST.html`](GET-POKEMON-CHEST.html)** (one page, three paths),
or the rolling release **[chest-latest](https://github.com/Sparkey333/pokemon-chest/releases/tag/chest-latest)**.
On a Mac you can also double‑click **`build-app.command`** to build a fresh DMG locally.

**[⬇ Download the latest Den build ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/dmg-latest)**

Current: **v2.4.0** — universal (Apple Silicon + Intel).
Assets: the universal `.dmg`, a source zip of the exact commit,
`SHA256SUMS.txt` and `OPEN-ANYWAY.command`.

Verify what you downloaded — the release notes carry the build's hash, and:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

Every push rebuilds it — `dmg-latest` is always the newest build.

### 📦 Pokémon Chest — the original line

Collection database, Scanner with the full TCGdex codex, sell/grade guidance.

**[⬇ Download the latest Chest build ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/chest-latest)**

Assets: the universal `.dmg`, a source zip, `GET-POKEMON-CHEST.html`,
`OPEN-ANYWAY.command` and `SHA256SUMS.txt`.

### Build it yourself (recommended)

Clone the repo, then double-click **`build-app.command`**. It regenerates the
full icon set from `icon-source.png` and produces `Pokémon DenZ.app` plus a
styled `.dmg` in `src-tauri/target/release/bundle`. A local build signs with
your own Apple identity, so it opens on a clean double-click and skips the
Gatekeeper step entirely. (By hand: `cd src-tauri && cargo tauri build`.)

### Gatekeeper: "can't be verified"

That dialog means the build is ad-hoc signed — not that the download is broken.
Any one of these clears it:

1. Double-click **`OPEN-ANYWAY.command`** (in the repo, and on the Chest release), or
2. System Settings → Privacy & Security → **Open Anyway**, or
3. `xattr -cr "/Applications/Pokémon DenZ.app"`

Real notarization needs a paid Apple Developer Program membership; the build
pipeline is ready to sign, notarize and staple once those credentials exist.

---

## Run it without installing anything

The app is a tiny Python-stdlib server plus a static front end — no build step:

```bash
./start.command          # then open http://localhost:8787
```

Keep the little Terminal window open while you browse; close it (or Ctrl-C) to
stop.

> Don't just double-click `index.html` — browsers block `file://` pages from
> reading local data, so the collection won't load. Use the launcher or the app.

📱 **On your iPhone:** in the app, go to **📷 Scanner → Phone mode**, scan the QR
with your phone, and the full app opens there — camera scanning included, with
photos saved onto the matching card's file on your Mac. HTTPS via a locally
generated self-signed certificate when `openssl` is available (accept the
one-time warning; it's your own Mac). Same Wi-Fi, no App Store. Home networks
only — turn it off when you're done.

Once it's open on the phone, **keep it there**: tap Share ⬆︎ → **Add to Home
Screen** (Android: your browser's **Install**). It's a full PWA, so it launches
fullscreen with no browser chrome and still opens when you're out of signal —
the app shell and your collection are cached locally. Live prices and AI calls
always go to the network; they're never served from cache.

☁️ **Moved your files into iCloud Drive?** Run **`fix-icloud.command`**. The app
detects a project living inside iCloud, routes writable state to
`~/Library/Application Support/PokemonChest`, and forces cloud-only `.icloud`
placeholder exports to download before reading them.

---

## The views

| View | What it does |
|------|--------------|
| **Dashboard** | Your action board: portfolio value, cost basis, unrealized P/L, EN‑vs‑JP & raw‑vs‑graded splits, top sets, most valuable cards, a value‑over‑time chart, and a **feedback card**. |
| **Collection** | Every entry with card art. Search + filter by language, set, era, graded/raw, status, and price; sort by value, profit, return %, name, or date added. |
| **🧩 Sets** | Set-completion progress against each set's real size, with the missing-card list, an official/master-set toggle, and a PriceCharting cost-to-complete. Runs off a bundled 31,603-card codex — no API key, works offline. |
| **➕ Add & Sold** | The ledger: **add cards in‑app** (typed or scanned), **record every sale** (price/fees/venue/date), and **archive** sold cards — kept forever with their photos & sale data on the **Sold Shelf**. Imports an eBay orders CSV or a pasted sale email. Exports a sales CSV. |
| **📷 Scanner** | Camera capture: hold a card up to your Mac camera (or iPhone via Continuity), snap it, and the photo is **stored with that card's file**. Reads a whole **9-pocket binder page** from one photo. Searches in three tiers — your collection, the bundled codex, then the live PriceCharting catalog. |
| **🤝 Trade** | Stack what you'd give against what you'd get; the app prices both sides and calls it. Cards come from your collection, the catalog or the offline codex. Unpriced cards are held out of the verdict, not counted as zero — and the closing line compares the trade against what *selling* your side would net after fees. |
| **🏠 The Den** | Your collection as a walk‑in 3D display room: trophy wall, slab shelf, side gallery, spinning pedestal card, live value ticker, auto-built shelves and a **💸 Sold Shelf**. Drag to look, scroll to walk, click any card. **🥽 VR** splits it into a stereo pair for a Cardboard-style phone headset. |
| **🧊 3D Studio** | Turn any card into a 3D visual asset — drag/auto‑spin viewer with a holo‑foil effect and a fullscreen **Showcase mode** — plus **3D‑print STL exports** sized to raw / toploader / slab. |
| **🧪 Grade Lab** | Centering calculator, flaw checklist, **AI photo pre-grade**, and grade-ROI break-even math against the card's grade ladder. |
| **💰 Best Sellers** | What to sell *right now*: liquidity scoring, the top‑25 **Best‑Sell Board** with fee‑adjusted nets, and playbooks for **eBay auctions, Whatnot live, YouTube, Facebook, TCGplayer, Mercari**. |
| **🏷 Brand Lab** | Brand build‑out for bulk cards: IP‑safe name/logo directions, packaging product lines, AI art prompts, print‑cost tables, and a phased roadmap. |
| **Sell Hub** | Cards ranked for selling with fee‑adjusted **net estimates**, one‑click **sold comps**, a **Grading Candidates** list with break‑even math, and your **For‑sale** worklist. |
| **Sell & Grade Guide** | Current grading tiers & costs, when to grade vs. not, grade‑value multiples, marketplace fees, and the best venue per card type — with sources. |
| **📋 Parity** | The live feature ledger from `data/parity.json` — every feature with status, spec, acceptance criteria and file pointers. |

Every card also gets a tailored grade/sell recommendation, direct live‑comp searches for
that exact card, sell math, and a private note + "For sale / Sold" tags.

---

## Keeping prices current — the ↻ Refresh flow

1. On **PriceCharting.com**: Collection → **Download** (Excel).
2. Drop the new `.xlsx` into this project folder, **`~/Downloads`**, Desktop,
   Documents, or **iCloud Drive** (any name containing "PriceCharting").
3. Click **↻ Refresh** in the app's top bar. It finds the newest export, rebuilds
   `data/collection.json` (new prices + new cards, re‑fetching card art), and reloads.

Fallback: double‑clicking `refresh-data.command` does exactly the same rebuild from
Terminal. Your value‑over‑time history, For‑sale / Sold tags, and notes are stored
privately in your browser and survive every refresh.

### After migrating to iCloud Drive

If this project (or your exports) moved into iCloud:

1. Double‑click **`fix-icloud.command`** once — it scans Desktop / Documents /
   Downloads / iCloud Drive, downloads cloud‑only placeholders when possible, and
   seeds a local writable home.
2. When the project itself lives in iCloud, live writes (settings, rebuilt data,
   card art) go to **`~/Library/Application Support/PokemonChest`** so iCloud sync
   doesn't fight the server. Launchers set this automatically.
3. Then use **`start.command`** as usual.

---

## Optional live data & AI (BYOK)

Pokémon Chest is fully usable with zero keys. If you want live data, open **Settings**
in‑app and paste your own keys (bring‑your‑own‑key):

| Key | Unlocks |
|-----|---------|
| **PriceCharting token** | Live current prices by product id, plus Scanner catalog search via PriceCharting’s `/api/products` (same connection their site uses). |
| **Comps API key** | Live sold comps (eBay / TCGplayer / JP marketplaces) without leaving the app. |
| **Claude or OpenAI key** | AI sell/grade recommendations per card, plus **photo Identify** in Scanner. Default model: `claude-sonnet-4-6` (Anthropic) or `gpt-4o` (OpenAI). |

### Scanner + release codex (no key required)

The Scanner tab searches a local **card codex** built from [TCGdex](https://tcgdex.dev) — English and Japanese sets, including special/secret rares past the official set count. Rebuild anytime with **↻ Rebuild Codex** in Scanner, or:

```bash
python3 scripts/build_codex.py
```

With a PriceCharting token connected, Scanner also queries their product catalog by name/number (unique product ids). On a Mac, Continuity Camera lists your iPhone; or enable **Phone mode** for a same‑Wi‑Fi LAN link.

Keys are stored **only** in `settings.local.json` in this folder — gitignored, never
uploaded, and **never bundled into a shipped build**. The local server proxies your
requests directly to each provider; nothing passes through any third party.

---

## Privacy

- **100% local.** Your collection, prices, notes, and history never leave your Mac.
  The only network calls are card images (from [TCGdex](https://tcgdex.dev), a free open
  card API), the comp links *you* click, and — only if you add keys — the BYOK APIs above.
- Card art is baked in for most cards; the rest (mostly generic promos and brand‑new JP
  sets) show a labelled placeholder that still links to the real PriceCharting page.

## Files

```
Pokemon Chest/
├─ PriceCharting-collection.xlsx   your export (the source of truth)
├─ index.html                      the app UI
├─ assets/    app.js, revamp.js, a11y.js, pwa.js, styles.css, revamp.css
│             pwa/                 home-screen icons (any + maskable)
├─ manifest.webmanifest            install metadata (Android/Chrome)
├─ sw.js                           offline shell — never caches live prices
├─ data/      collection.json      built from your xlsx (prices, images, links)
│             codex.json           full EN+JA Pokémon TCG release index (TCGdex)
│             selling-intel.json   grading/fee/venue guidance
├─ scripts/   build_data.py        xlsx → collection.json (+ image matching)
│             build_codex.py       TCGdex EN+JA → data/codex.json
├─ server.py                       local server + optional BYOK API proxy
├─ src-tauri/                      native macOS shell ("Pokémon DenZ.app")
│             PrivacyInfo.xcprivacy  Apple privacy manifest (declares: nothing)
├─ STORE-LISTING.md                submission copy, review notes, checklist
├─ settings.local.json             your BYOK keys (gitignored — never commit)
├─ start.command                   ▶ double‑click to launch in the browser
├─ refresh-data.command            ↻ fallback data refresh (the in‑app ↻ does this too)
└─ README.md
```

## Not financial advice

Grading costs, fees, multiples, and venue guidance are compiled from public hobby
sources and change often. Prices are estimates. **Always check live sold comps before
you sell or grade** — decisions and outcomes are yours.

---

## Store publishing

See **[STORE.md](STORE.md)** for Mac App Store, direct (Gumroad/Lemon), itch.io, Microsoft Store, and Steam — positioned as a **one-time owned vault**, not a subscription.
