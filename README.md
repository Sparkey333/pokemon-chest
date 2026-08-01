# Pokémon Den 🔴⚪

A **free, 100% local** database and sell/grade advisor for your Pokémon card
collection — built from your PriceCharting export. English **and** Japanese, real
card art, one-click live sold-comp links, grading break-even math, and
(optionally, bring-your-own-key) live price data and AI recommendations.

No accounts. No subscriptions. No telemetry. Every core feature works with **no
API keys at all**, and your collection never leaves your Mac.

---

## ⬇️ Download

Two builds are published as rolling releases. Both are **ad-hoc signed**, not
notarized — see [Gatekeeper](#gatekeeper-cant-be-verified) below.

### 🏠 Pokémon Den — the current line

The 3D Den room, Scanner (single card + 9-pocket binder page), Add & Sold
ledger, Sets completion tracker, price alerts, per-card price history, AI
pre-grade, Best Sellers and Brand Lab.

**[⬇ Download the latest Den build ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/dmg-latest)**

Current: **v2.3.0** — universal (Apple Silicon + Intel), commit `8b5ee95`.
Assets: `Pokemon.Den_2.3.0_universal.dmg` and `PokemonDen-source-8b5ee95.zip`.

```
sha256  5efba33fa6fd133728fdba574e3104ba7ced041f26b29ce312a2aa063d83f615
        Pokemon.Den_2.3.0_universal.dmg
```

Every push rebuilds it — `dmg-latest` is always the newest build.

### 📦 Pokémon Chest — the original line

Collection database, Scanner with the full TCGdex codex, sell/grade guidance.

**[⬇ Download the latest Chest build ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/chest-latest)**

Assets: the universal `.dmg`, a source zip, `GET-POKEMON-CHEST.html`,
`OPEN-ANYWAY.command` and `SHA256SUMS.txt`.

### Build it yourself (recommended)

Clone the repo, then double-click **`build-app.command`**. It regenerates the
full icon set from `icon-source.png` and produces `Pokemon Den.app` plus a
styled `.dmg` in `src-tauri/target/release/bundle`. A local build signs with
your own Apple identity, so it opens on a clean double-click and skips the
Gatekeeper step entirely. (By hand: `cd src-tauri && cargo tauri build`.)

### Gatekeeper: "can't be verified"

That dialog means the build is ad-hoc signed — not that the download is broken.
Any one of these clears it:

1. Double-click **`OPEN-ANYWAY.command`** (in the repo, and on the Chest release), or
2. System Settings → Privacy & Security → **Open Anyway**, or
3. `xattr -cr "/Applications/Pokemon Den.app"`

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
| **🏠 The Den** | Your collection as a walk‑in 3D display room: trophy wall, slab shelf, side gallery, spinning pedestal card, live value ticker, auto-built shelves and a **💸 Sold Shelf**. Drag to look, scroll to walk, click any card. |
| **🧊 3D Studio** | Turn any card into a 3D visual asset — drag/auto‑spin viewer with a holo‑foil effect and a fullscreen **Showcase mode** — plus **3D‑print STL exports** sized to raw / toploader / slab. |
| **🧪 Grade Lab** | Centering calculator, flaw checklist, **AI photo pre-grade**, and grade-ROI break-even math against the card's grade ladder. |
| **💰 Best Sellers** | What to sell *right now*: liquidity scoring, the top‑25 **Best‑Sell Board** with fee‑adjusted nets, and playbooks for **eBay auctions, Whatnot live, YouTube, Facebook, TCGplayer, Mercari**. |
| **🏷 Brand Lab** | Brand build‑out for bulk cards: IP‑safe name/logo directions, packaging product lines, AI art prompts, print‑cost tables, and a phased roadmap. |
| **Sell Hub** | Cards ranked for selling with fee‑adjusted **net estimates**, one‑click **sold comps**, a **Grading Candidates** list with break‑even math, and your **For‑sale** worklist. |
| **Sell & Grade Guide** | Current grading tiers & costs, when to grade vs. not, grade‑value multiples, marketplace fees, and the best venue per card type — with sources. |
| **📋 Parity** | The live feature ledger from `data/parity.json` — every feature with status, spec, acceptance criteria and file pointers. |

Every card also gets a tailored grade/sell recommendation, direct live‑comp
searches, sell math, price history, price alerts, and a private note.

---

## Keeping inventory current — automatic

1. On **PriceCharting.com**: Collection → **Download** (Excel).
2. Leave the `.xlsx` anywhere the app looks — `~/Downloads`, Desktop, Documents,
   the project folder, or iCloud Drive (any name containing "PriceCharting").
   **That's it** — the app pulls new cards + prices in on its own within ~20
   seconds. ↻ Refresh is the manual trigger.
3. One-off adds without an export: **➕ Add & Sold → search the PriceCharting
   catalog** and add any card with one click.

---

## Optional live data & AI (BYOK)

Pokémon Den is fully usable with zero keys. To add live data, open **⚙ Live**
in-app and paste your own:

| Key | Unlocks |
|-----|---------|
| **PriceCharting token** | Live prices straight from PriceCharting's API — including **one-click bulk sync** that re-prices the whole collection (raw + graded tiers), plus catalog search and set cost-to-complete. |
| **Comps API key** | Live sold comps (eBay / TCGplayer / JP marketplaces) without leaving the app. |
| **Claude or OpenAI key** | AI card identify, binder-page reading, condition pre-grade, and sell/grade recommendations. |

Keys are stored **only** in `settings.local.json` — gitignored, never uploaded,
never bundled into a shipped build. The local server proxies your requests
straight to each provider; nothing passes through any third party.

---

## Privacy

No accounts, no analytics, no tracking. Your collection, prices, notes, sales
and photos never leave your Mac. The only network calls are card art from
[TCGdex](https://tcgdex.dev), the comp links *you* click, and — only if you add
keys — the BYOK APIs above. An optional local-only error log (off by default,
⚙ Live) is never transmitted anywhere automatically.

Details: [`LEGAL.md`](LEGAL.md), also readable in-app from the About panel.

---

## Files

```
Pokemon Den/
├─ PriceCharting-collection.xlsx   your export (the source of truth)
├─ index.html                      the app UI
├─ assets/    app.js, revamp.js, styles.css, revamp.css
├─ data/      collection.json      built from your xlsx (prices, images, links)
│             codex.json           395 sets / 31,603 EN+JA cards (TCGdex)
│             parity.json          the live feature ledger
│             selling-intel.json   grading/fee/venue guidance
│             build-flags.json     build profile (publicArt, shipBuild)
├─ scripts/   build_data.py        xlsx → collection.json (+ image matching)
│             build_codex.py       rebuilds the card codex from TCGdex
│             mac_paths.py         iCloud/Drive path resolution
├─ server.py                       local server + optional BYOK API proxy
├─ src-tauri/                      native macOS shell ("Pokémon Den.app")
├─ settings.local.json             your BYOK keys (gitignored — never commit)
├─ start.command                   ▶ launch in the browser
├─ build-app.command               🔨 build the .app + .dmg
├─ fix-icloud.command              ☁️ repair paths after an iCloud migration
├─ OPEN-ANYWAY.command             🔓 clear quarantine + launch
└─ README.md
```

---

## Legal

**Unofficial and fan-made.** Not affiliated with, endorsed, sponsored or approved
by Nintendo, The Pokémon Company, Creatures Inc., GAME FREAK inc., or
PriceCharting.

**Pokémon © Nintendo / Creatures Inc. / GAME FREAK inc.** Pokémon and all
character names, card artwork and logos are trademarks and copyrights of their
owners, used here only to identify cards in a collector's own collection. Card
images come from [TCGdex](https://tcgdex.dev). Marketplace names are trademarks
of their respective owners.

"Pokémon Den" / "Pokémon Chest" are working names for personal use. Any public
product release would ship under an original name without "Pokémon" in it — see
[`ROADMAP-TO-PUBLISH.md`](ROADMAP-TO-PUBLISH.md).

## Not financial advice

Grading costs, fees, multiples and venue guidance are compiled from public hobby
sources and change often. Prices are estimates. **Always check live sold comps
before you sell or grade** — decisions and outcomes are yours.
