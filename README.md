# Pokémon Chest 🔴⚪

A premium‑style, **free** database & sell/grade advisor for your Pokémon card
collection — built from your PriceCharting export. English **and** Japanese, card art,
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

**Download (macOS):** the rolling release **[dmg-latest](https://github.com/Sparkey333/pokemon-chest/releases/tag/dmg-latest)**
on GitHub has the universal DMG + a source zip. Or double‑click **`build-app.command`**
on a Mac to build locally.

> Don't just double‑click `index.html` — browsers block `file://` pages from reading
> local data, so the collection won't load. Use the launcher or the app.

---

## The views

| View | What it does |
|------|--------------|
| **Dashboard** | Your action board: portfolio value, cost basis, unrealized P/L, EN‑vs‑JP & raw‑vs‑graded splits, top sets, most valuable cards, a value‑over‑time chart, and a **feedback card** for sending suggestions. |
| **Scanner** | Mac / Continuity Camera / iPhone phone‑mode capture. Search the **full TCGdex EN+JA release codex** (every set + special/secret rares) and — with your PriceCharting token — the same **`/api/products`** catalog PriceCharting uses. Optional AI photo Identify (BYOK). |
| **Collection** | Every entry with card art. Search + filter by language, set, era, graded/raw, status, and price; sort by value, profit, return %, name, or date added. Click any card for full detail. |
| **Sell Hub** | Cards ranked for selling with fee‑adjusted **net estimates**, one‑click **sold comps** (eBay raw + graded, TCGplayer, 130point, Mercari, PriceCharting), a **Grading Candidates** list with break‑even math and estimated PSA‑10 value, and your **For‑sale** worklist. |
| **Sell & Grade Guide** | Current grading tiers & costs, when to grade vs. not, grade‑value multiples, marketplace fees, and the best venue for raw English / graded / Japanese cards — with sources. |

Every card also gets a tailored grade/sell recommendation, direct live‑comp searches for
that exact card, sell math, and a private note + "For sale / Sold" tags.

---

## Keeping prices current — the ↻ Refresh flow

1. On **PriceCharting.com**: Collection → **Download** (Excel).
2. Drop the new `.xlsx` into this project folder **or just leave it in `~/Downloads`**
   (any name containing "PriceCharting").
3. Click **↻ Refresh** in the app's top bar. It finds the newest export, rebuilds
   `data/collection.json` (new prices + new cards, re‑fetching card art), and reloads.

Fallback: double‑clicking `refresh-data.command` does exactly the same rebuild from
Terminal. Your value‑over‑time history, For‑sale / Sold tags, and notes are stored
privately in your browser and survive every refresh.

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
├─ assets/    app.js, styles.css
├─ data/      collection.json      built from your xlsx (prices, images, links)
│             codex.json           full EN+JA Pokémon TCG release index (TCGdex)
│             selling-intel.json   grading/fee/venue guidance
├─ scripts/   build_data.py        xlsx → collection.json (+ image matching)
│             build_codex.py       TCGdex EN+JA → data/codex.json
├─ server.py                       local server + optional BYOK API proxy
├─ src-tauri/                      native macOS shell ("Pokémon Chest.app")
├─ settings.local.json             your BYOK keys (gitignored — never commit)
├─ start.command                   ▶ double‑click to launch in the browser
├─ refresh-data.command            ↻ fallback data refresh (the in‑app ↻ does this too)
└─ README.md
```

## Not financial advice

Grading costs, fees, multiples, and venue guidance are compiled from public hobby
sources and change often. Prices are estimates. **Always check live sold comps before
you sell or grade** — decisions and outcomes are yours.
