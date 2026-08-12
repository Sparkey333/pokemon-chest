# Store listing pack

Everything an App Store / Play / Steam submission asks for in prose, written
once so it doesn't get improvised at 1 a.m. in App Store Connect.

> **Blocked on the rename.** Every string below says `<APP>`. Run
> `bash scripts/rename.sh "<Name>"` once Brandon picks one (shortlist in
> `ROADMAP-TO-PUBLISH.md` §1) and replace `<APP>` throughout. Nothing here may
> ship containing "Pokémon" — see the Legal section of that doc.

---

## Names & IDs

| Field | Value |
|---|---|
| App name (30 char max, App Store) | `<APP>` |
| Subtitle (30 char max) | Card collection & sell advisor |
| Bundle identifier | **unchanged** — the existing id in `src-tauri/tauri.conf.json`. Never edit it; it's what installed builds key their data to. |
| SKU | `<app>-mac-01` |
| Primary category | Utilities |
| Secondary category | Lifestyle |
| Age rating | 4+ — no user-generated content, no ads, no in-app purchases, no gambling |

## Promotional text (170 char max)

> Your card collection, priced and organised on your own machine. Scan cards,
> track set completion, watch prices, and check a trade before you shake on it.

## Description

`<APP>` turns a shoebox of trading cards into something you can actually reason
about — what it's worth, what's worth selling, what's worth grading, and what's
still missing from a set.

It runs entirely on your own machine. No account, no subscription, no
telemetry. Your collection, your notes, your sale history and your photos never
leave the device.

**What it does**

- **Collection** — every card with art, filters by language, set, era and
  grade, with portfolio value and profit/loss
- **Set completion** — progress against each set's real size, the full
  missing-card list, and a cost-to-complete. Runs off a bundled 31,603-card
  index, so it works offline with no API key
- **Scanner** — hold a card up to the camera, or read all nine cards of a
  binder page from a single photo
- **Add & Sold** — record sales with fees and venue, archive sold cards to a
  permanent shelf, and import an orders CSV or a pasted sale email
- **Trade checker** — stack both sides of a trade, price them, and get a
  fairness verdict that accounts for the marketplace fees a trade avoids
- **Grade lab** — centering calculator, flaw checklist, and break-even maths
  against the card's grade ladder
- **The Den** — your collection as a walk-in 3D room, with a stereo mode for a
  phone VR headset
- **Price alerts and per-card history** — thresholds that tell you when
  something moves, and a chart of where it's been

**Bring your own keys, or don't**

Every core feature works with no API keys at all. Add your own PriceCharting or
AI key and you get live prices, catalog search and photo identification —
sent from your machine straight to that provider, stored only on your machine.

**Not affiliated with any trading card publisher.** Card names and images
belong to their respective owners and are used only to identify cards in your
own collection.

## Keywords (100 char max, comma separated, no spaces)

`cards,collection,tcg,collector,grading,binder,scanner,setlist,portfolio,trade,inventory,comics`

## Support & marketing URLs

| Field | Value |
|---|---|
| Support URL | *(needed — a GitHub Pages page or the repo's issues tab)* |
| Marketing URL | *(optional)* |
| Privacy policy URL | *(needed — publish `LEGAL.md`'s Privacy section as a page)* |

## App privacy answers (App Store Connect questionnaire)

Answer **"No, we do not collect data from this app"** to the first question.
That is accurate and it ends the questionnaire — nothing is transmitted to us,
because there is no "us": there's no server, no account and no analytics.

If asked about third parties: the app loads card artwork from a public card
database, and — only when the user supplies their own API key — sends requests
from their device to the provider they chose. Neither is collection by the
developer.

Machine-readable counterpart: `src-tauri/PrivacyInfo.xcprivacy`.

## Review notes (the box that decides how smoothly this goes)

> This is a local-first collection manager. It ships no account system and
> makes no network calls unless the user supplies their own API key, so there
> are no demo credentials to provide — launch it and every feature is
> available.
>
> The app bundles a local HTTP server on 127.0.0.1 that serves its own UI and
> data files. It binds to loopback only. Administrative routes are additionally
> gated to loopback even when the user opts into the LAN feature described
> below.
>
> There is an **optional, off-by-default** LAN mode that lets the user open the
> app from their own phone on the same Wi-Fi in order to scan cards with the
> phone camera. It is explicitly enabled by the user, is off on every launch,
> and cannot administer the app or read credentials.
>
> Card names and artwork identify cards in the user's own collection. Artwork
> is loaded from a public card database and is attributed in the app's About
> panel. The `publicArt` build flag ships a build with no external artwork at
> all if that is preferred.

## Screenshots to capture

Required sizes are in Apple's spec; capture at the largest and let Connect
downscale. Order matters — the first two are what people actually see.

1. **The Den** — the 3D room, full of the user's own cards. The hook.
2. **Collection** — the grid with real values and filters. The substance.
3. **Sets** — a progress bar mid-completion with the missing list open.
4. **Scanner** — a binder page mid-read, nine cards recognised.
5. **Trade checker** — a two-sided trade with the verdict banner visible.
6. **Grade lab** — the centering calculator with a result.

Use a demo collection, not Brandon's real one — screenshots are public forever.

## Pre-submission checklist

- [ ] Rename applied; no occurrence of "Pokémon"/"Poké" in the name, icon,
      screenshots or description (`grep -ri "pok" ` the built bundle)
- [ ] `shipBuild: true` in `data/build-flags.json` for the submitted build
- [ ] `PrivacyInfo.xcprivacy` present in the bundle
- [ ] Paid Apple Developer Program membership active
- [ ] Signed with a Developer ID / Distribution certificate, notarized, stapled
- [ ] Support URL and privacy policy URL live and reachable
- [ ] Screenshots taken from a demo collection
- [ ] Local server sandboxing resolved (see `ROADMAP-TO-PUBLISH.md` §4) — or
      ship direct-notarized outside the store, which avoids this entirely
