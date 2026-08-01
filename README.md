# Pokémon Den / Pokémon Chest 🔴⚪

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

| Build | What it is | Download |
|---|---|---|
| 🏠 **Pokémon Den** | The current line — adds the 3D Den room, Scanner (single card + 9-pocket binder), Add & Sold ledger, Sets completion tracker, price alerts, per-card history, AI pre-grade, Best Sellers and Brand Lab | **[dmg-latest ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/dmg-latest)** |
| 📦 **Pokémon Chest** | The original line — collection database, Scanner with the full TCGdex codex, sell/grade guidance | **[chest-latest ›](https://github.com/Sparkey333/pokemon-chest/releases/tag/chest-latest)** |

Each release carries the universal macOS `.dmg` (Apple Silicon + Intel), a source
zip of the exact commit, `OPEN-ANYWAY.command`, and `SHA256SUMS.txt`.

**Prefer building it yourself?** Clone, then double-click **`build-app.command`**.
A local build uses your own signing identity, so it opens with a clean
double-click and skips the Gatekeeper step entirely.

### Gatekeeper: "can't be verified"

That dialog means the build is ad-hoc signed, not that the download is broken.
Any one of these fixes it:

1. Double-click **`OPEN-ANYWAY.command`** from the release, or
2. System Settings → Privacy & Security → **Open Anyway**, or
3. `xattr -cr "/Applications/Pokemon Den.app"`

Real notarization needs a paid Apple Developer Program membership; when those
credentials exist the build pipeline is ready to sign, notarize and staple.

---

## Run it without installing anything

The app is a tiny Python-stdlib server plus a static front end — no build step:

```bash
./start.command          # then open http://localhost:8787
```

📱 **On your iPhone:** in the app, go to **📷 Scanner → Phone mode**, scan the QR
with your phone, and the full app opens there — camera scanning included, with
photos saved onto the matching card's file on your Mac. Same Wi-Fi, no App Store.

---

## What's inside

- **Collection** — every card with art, filters by language / set / era / grade,
  portfolio value and P/L
- **🧩 Sets** — completion progress per set with missing-card lists and
  cost-to-complete, powered by a bundled 31,603-card TCGdex codex that works
  offline with no API key
- **📷 Scanner** — Mac camera or iPhone capture; AI card identify; 9-pocket
  binder-page scanning that reads all nine cards from one photo
- **➕ Add & Sold** — add cards, record sales, archive sold cards to a permanent
  Sold Shelf; imports an eBay orders CSV or a pasted sale email
- **🏠 The Den** — your collection as a walk-in 3D room with auto-built shelves
- **🧪 Grade Lab** — centering calculator, flaw checklist, AI photo pre-grade, and
  grade-ROI break-even math
- **💰 Best Sellers / 🏷 Brand Lab** — what to sell now, and packaging/brand plans

Full feature ledger with status and specs: **`data/parity.json`**, rendered live
in the app's 📋 Parity tab.

---

## Privacy

No accounts, no analytics, no tracking. Your collection, notes, sales and photos
stay on your machine. The only network calls are card art from
[TCGdex](https://tcgdex.dev), links you click, and — only if you add your own key
— requests sent straight from your Mac to that one provider. Bring-your-own-key
credentials live in a gitignored `settings.local.json` and are never bundled.

Details: [`LEGAL.md`](LEGAL.md), also readable in-app from the About panel.

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
