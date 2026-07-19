# Pokémon Den 🔴⚪

A premium‑style, **free** database & sell/grade advisor for your Pokémon card
collection — built from your PriceCharting export. English **and** Japanese, card art,
one‑click live sold‑comp links, and (optionally, bring‑your‑own‑key) live price data and
AI recommendations. Runs 100% locally on your Mac: no accounts, no subscriptions, and
every core feature works with **no API keys at all**.

> Think PriceCharting *Premium* + a sell/grade advisor, but it's yours and it's free.

---

## Run it

**Easiest:** double‑click **`start.command`**. It launches a tiny local server
(`server.py`, Python stdlib only) and opens Pokémon Den in your browser at
`http://localhost:8787`. Keep the little Terminal window open while you browse; close it
(or Ctrl‑C) to stop. First time, macOS may ask you to confirm — right‑click → Open, or
System Settings → Privacy & Security → "Open Anyway".

**Native app:** once built, open **`Pokémon Den.app`** (or install from the `.dmg`) —
same app, no Terminal or browser needed. The Tauri shell in `src-tauri/` wraps the exact
same local server and UI.

> Don't just double‑click `index.html` — browsers block `file://` pages from reading
> local data, so the collection won't load. Use the launcher or the app.

---

## The views

| View | What it does |
|------|--------------|
| **Dashboard** | Your action board: portfolio value, cost basis, unrealized P/L, EN‑vs‑JP & raw‑vs‑graded splits, top sets, most valuable cards, a value‑over‑time chart, and a **feedback card** for sending suggestions. |
| **Collection** | Every entry with card art. Search + filter by language, set, era, graded/raw, status, and price; sort by value, profit, return %, name, or date added. Click any card for full detail. |
| **➕ Add & Sold** | The ledger: **add cards in‑app** (typed or scanned — they survive refreshes and join every tab), **record every sale** (price/fees/venue/date), and **archive** sold cards — kept forever with their photos & sale data on the **Sold Shelf**, just out of your collection totals. Exports a sales CSV. |
| **📷 Scanner** | Smooth camera capture: hold a card up to your Mac camera (or iPhone via Continuity), snap it, and the photo is **stored with that card's file**. Includes **Phone mode** — a LAN/QR link (HTTPS when possible) so your phone opens the app and scans directly — and the **PriceCharting sync** panel (below). |
| **🏠 The Den** | Your collection as a walk‑in 3D display room (Amber‑Den‑style): trophy wall, slab shelf, side gallery, a spinning pedestal card, a live value ticker, and a **💸 Sold Shelf**. Drag to look, scroll to walk, click any card. Every display is auto‑loaded and editable (source pickers + 3 themes). |
| **🧊 3D Studio** | Turn any card into a 3D visual asset — draggable/auto‑spin viewer with a holo‑foil effect and a fullscreen **Showcase mode** (screen‑record it for Shorts) — plus **3D‑print STL exports**: an easel stand and a wall frame, auto‑sized to raw / toploader / slab. |
| **💰 Best Sellers** | What to sell *right now*: every card scored for liquidity (price band × era × set heat), the top‑25 **Best‑Sell Board** with fee‑adjusted nets, and the channel matrix + playbooks for **eBay auctions (bidding), Whatnot live, YouTube, Facebook, TCGplayer, Mercari**. |
| **🏷 Brand Lab** | The brand build‑out for your millions of spare cards: IP‑safe name/logo directions, packaging product lines (Era Vault Packs, Mystery Chests, Frame‑Ready Sets…), AI art prompts, print‑cost tables, stand‑out moves, and a phased roadmap. |
| **Sell Hub** | Cards ranked for selling with fee‑adjusted **net estimates**, one‑click **sold comps** (eBay raw + graded, TCGplayer, 130point, Mercari, PriceCharting), a **Grading Candidates** list with break‑even math and estimated PSA‑10 value, and your **For‑sale** worklist. |
| **Sell & Grade Guide** | Current grading tiers & costs, when to grade vs. not, grade‑value multiples, marketplace fees, and the best venue for raw English / graded / Japanese cards — with sources. |

Every card also gets a tailored grade/sell recommendation, direct live‑comp searches for
that exact card, sell math, and a private note + "For sale / Sold" tags.

---

## Phone mode — scan from your phone

In **📷 Scanner → Phone mode**, one click starts a same‑Wi‑Fi address (HTTPS with a
locally generated self‑signed certificate when `openssl` is available — accept the
one‑time warning; it's your own Mac). Scan the QR on your phone and the full app opens
there, Scanner included: snap a card with the phone camera and the photo lands in that
card's file on your Mac. Home networks only — turn it off when you're done.

## Keeping inventory current — now automatic

1. On **PriceCharting.com**: Collection → **Download** (Excel).
2. Leave the `.xlsx` in `~/Downloads` (any name containing "PriceCharting"). **That's it** —
   the app watches for new exports and pulls new cards + prices in on its own within
   ~20 seconds (toggle in 📷 Scanner → PriceCharting sync). ↻ Refresh still works as the
   manual trigger.
3. One-off adds without an export: **➕ Add & Sold → search the PriceCharting catalog**
   (token required) and add any card with one click — name, set, number, and price fill
   themselves. No typing card details.

## Rebuilding the Mac app (.dmg)

The native app wraps this exact server + UI, so every new feature lands in it on the
next build. On your Mac, just double‑click **`build-app.command`** — it regenerates the
full icon set from `icon-source.png` and produces `Pokemon Den.app` + a styled `.dmg`
(Amber Den background, drag‑to‑Applications layout) in `src-tauri/target/release/bundle`.
(Equivalent by hand: `cd src-tauri && cargo tauri build`.)

Fallback: double‑clicking `refresh-data.command` does exactly the same rebuild from
Terminal. Your value‑over‑time history, For‑sale / Sold tags, and notes are stored
privately in your browser and survive every refresh.

---

## Optional live data & AI (BYOK)

Pokémon Den is fully usable with zero keys. If you want live data, open **Settings**
in‑app and paste your own keys (bring‑your‑own‑key):

| Key | Unlocks |
|-----|---------|
| **PriceCharting token** | Live current prices straight from PriceCharting's API — including **one‑click bulk sync** (Scanner tab) that re‑prices the *whole* collection (raw + graded tiers) without downloading an export. New cards you add on PriceCharting still arrive via the export + ↻ Refresh flow. |
| **Comps API key** | Live sold comps (eBay / TCGplayer / JP marketplaces) without leaving the app. |
| **Claude or OpenAI key** | AI sell/grade recommendations per card. Default model: `claude-fable-5` (Anthropic) or `gpt-4o` (OpenAI). |

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
Pokemon Den/
├─ PriceCharting-collection.xlsx   your export (the source of truth)
├─ index.html                      the app UI
├─ assets/    app.js, styles.css
├─ data/      collection.json      built from your xlsx (prices, images, links)
│             selling-intel.json   grading/fee/venue guidance
├─ scripts/   build_data.py        xlsx → collection.json (+ image matching)
├─ server.py                       local server + optional BYOK API proxy
├─ src-tauri/                      native macOS shell ("Pokémon Den.app")
├─ settings.local.json             your BYOK keys (gitignored — never commit)
├─ start.command                   ▶ double‑click to launch in the browser
├─ refresh-data.command            ↻ fallback data refresh (the in‑app ↻ does this too)
└─ README.md
```

## Not financial advice

Grading costs, fees, multiples, and venue guidance are compiled from public hobby
sources and change often. Prices are estimates. **Always check live sold comps before
you sell or grade** — decisions and outcomes are yours.
