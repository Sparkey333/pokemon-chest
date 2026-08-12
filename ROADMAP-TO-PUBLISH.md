# Pokémon Den → a publishable app: the roadmap

Working name **Pokémon Den** (personal build). This doc holds the strategy:
naming, store paths, and the open questions that need Brandon's answers.

> **The canonical execution tracker is `data/parity.json`**, rendered live in
> the app's **📋 Parity** tab — every feature with status, executable spec,
> acceptance criteria, file pointers, and a copy-able work order. Agents and
> future sessions (any model): work from parity.json, update statuses there
> when you ship, and keep this doc for strategy-level changes only.

---

## 1 · Naming

"Pokémon" in a public product name will be refused by Apple/Google review and
invites a Nintendo C&D. Personal build keeps **Pokémon Den**; the shipped build
needs an original name with no "Pokémon"/"Poké" in it, and no collision with
Collectr, Dex, Shiny, PullVault, PokéVault, CollectorVault, CollX, pkmn.gg,
Slabfy or Pokellector.

### The shortlist — three angles, one pick each

| Name | The read | Why it's the pick for its angle |
|------|----------|--------------------------------|
| **Vitrine** ⭐ | *The 3D room.* A vitrine is the actual word for a glass display cabinet. | Real word, upscale, zero hobby cliché, and it literally names what the Den tab already is. Reads as a product, not a utility. Cross-hobby by default. |
| **Longbox** ⭐ | *The collector.* The comics/sports storage box everyone in the hobby knows. | Warm, concrete, instantly signals "collector" without naming a game. Trivial logo (a box). Carries the multi-TCG plan for free. |
| **Compsheet** ⭐ | *The advisor.* Sold comps + fee-adjusted net + grade break-even — the thing the app actually does that others don't. | Names the differentiator instead of the container. Best fit if v1 targets sellers. Plain `Comps` is stronger but far harder to clear. |

### The full batch

| Name | Read | Notes |
|------|------|-------|
| **Vitrine** | display cabinet | Shortlist. Check `vitrine.app` — `.com` is likely gone. |
| **Longbox** | collector storage | Shortlist. Comics-adjacent goodwill; check for comics-app collisions. |
| **Compsheet** | sold comps + net math | Shortlist. Descriptive, so a weaker trademark — pair with a distinct logo. |
| **Curio** | cabinet of curiosities | Warm, one word. Common product word — clearance risk is real. |
| **Backroom** | where the good stuff is kept | Insider, a little cheeky. Reads slightly retail-inventory. |
| **Atrium** | the walk-in room | Calm and architectural; fits the Den's scale. Generic-ish. |
| **Under Glass** | slabs, literally | Most evocative of the batch. Two words hurt as an app name. |
| **Sleeved** | every card goes in one | Short, hobby-native, verb-y. May read too niche outside TCG. |
| **Mintwright** | maker + "mint" | Same craft feel you liked in *Cardwright*, but hobby-native. |
| **Hoardly** | affectionate hoarding | Playful, modern-SaaS shape, easy to clear. Less premium. |
| **Denwright** | keeps the Den lineage | Bridge if you want continuity with the working name. |
| **Pull Room** | where you open packs | Great for the streaming/Whatnot audience. Near *PullVault* — check hard. |

Mechanics: the display name is a plain string everywhere — internal ids stay
`pokechest.*` forever for data compatibility. The swap is one command:
`bash scripts/rename.sh "Vitrine"`.

Before committing to any of these: USPTO TESS search, App Store + Google Play
name search, and a domain check (`.app` is the realistic target for all of them).

## 2 · Researched feature backlog (competitor + community sweep)

Sources: Collectr, Dex, Shiny, PullVault, PokéVault, CollectorVault, CollX,
pkmn.gg, Eyevo, PriceCharting app reviews, and app-store/blog comparisons
(see links in the PR). The 12 most-agreed-on wants, ranked by demand × fit:

1. **Bulk binder-page scan** ✅ 2026-07-24 — read all 9 cards of a binder page in
   one photo (PullVault's killer feature; #1 complaint about single-card
   scanners). Shipped in Scanner: 🗂 Scan a 9-pocket binder page.
2. **AI condition pre-grade from photos** ✅ 2026-07-26 — centering/corners/
   edges/surface estimate + grade-ROI verdict. Shipped in Grade Lab →
   Pre-grade a card → 📷 AI pre-grade from a photo: the AI's estimate blends
   with the existing centering/flaw-checklist math (whichever is lowest
   wins) and still feeds the same GradeStage-era $ + ROI verdict.
3. **Price alerts** ✅ 2026-07-27 — per-card above/below thresholds with a
   🔔 bell + badge in the header and a toast when one fires (deduped per
   card per day). Shipped: 🔔 Alert button in every card modal, bell panel
   listing armed thresholds + recent events. OS-level push notifications
   remain a later upgrade.
4. **Per-card price history charts** ✅ 2026-07-27 — every priced card now
   records its own price series (deduped, capped at 120 points, ~32 KB for
   1,100+ cards), charted in the card modal with a change caption plus a
   sparkline beside the Market price. Raw and graded copies that share a
   PriceCharting id are tracked separately, so a $2.56 raw card no longer
   shows its $36.92 PSA 8 sibling's history.
5. **Set completion tracker** ✅ 2026-07-27 — new **🧩 Sets** tab: every owned
   set with a progress bar against its real size, an official/master-set
   toggle, the full missing-card list, and a PriceCharting cost-to-complete.
   Computed from the bundled codex, so it needs no API key and works
   offline. Sets the codex lacks a card list for are shown flagged rather
   than silently dropped.
6. **Trade checker** ✅ 2026-08-01 — new **🤝 Trade** tab: stack what you'd give
   against what you'd get, and the app prices both sides and calls it.
   Cards come from the same three tiers the Scanner uses — your own
   collection (already priced), the PriceCharting catalog when a token is
   connected, then the bundled codex (free/offline, you type the price) —
   plus an add-by-hand row. Qty steppers, per-row price overrides, and the
   worksheet persists across reloads. Cards the app can't price are held
   *out* of the verdict and flagged rather than counted as $0. The verdict
   bands at 5 / 15 / 30% of the larger side, and the closing line is the
   trade-specific one: selling your side would cost ~11–13.6% in
   marketplace fees, so a trade only has to beat the **fee-adjusted net**,
   not the sticker total, to be the better move.
7. **Multi-TCG expansion** — Magic, Yu-Gi-Oh!, sports (Collectr's moat; your
   export already carries a `game` field — the UI just filters it today).
8. **Cloud backup / multi-device sync** — top complaint category everywhere;
   our LAN mode is the start (export/import encrypted snapshot → then real sync).
9. **Public showcase pages / Den tours** — share a read-only 3D Den link or
   clip (nobody has this; our Den + provenance QR make it a signature feature).
10. **Deck builder + wishlist** — pkmn.gg/Dex table stakes for the collector
    audience we don't serve yet.
11. **Graded-slab vault view** — pop reports, cert-number lookup, per-grade
    values in one place (Slabfy angle; we have cert fields + grade ladder).
12. **Offline-first mobile scanning with queue** — scans made offline sync when
    home (frequent complaint about scanner apps needing connection; our phone
    mode + staged scans extend naturally).
13. **Sell-side data pull: eBay CSV + sale-email import** ✅ 2026-07-25 — paste any
    "your item sold" / payment email or upload an eBay Seller Hub orders CSV;
    auto-matched to the right owned card and bulk-recorded as a sale in one
    click. Shipped in Add & Sold: 📥 Import sales. Kept 100%-local (paste/
    upload what you already have) rather than a live eBay OAuth integration —
    a BYOK eBay Sell API is a natural later upgrade, not yet scheduled.
14. **Search-cache-backed scan → add** ✅ 2026-07-25 — the PriceCharting catalog
    search server.py hits for the Ledger, Scanner, and binder-scan now shares
    one persistent, TTL'd cache (`search-cache.json`), and an AI-identified
    card the app doesn't already own auto-surfaces its catalog match right in
    the Scanner (single-card and per-pocket in a binder page) with a one-click
    add — no more bouncing to a separate search box to finish adding what the
    camera just read.

## 3 · The Summon (3D Pokémon novelty) — spec

"Summon" button on any card → its Pokémon appears in the Den as a 3D figure:

- **Stage 1 (ship first): Card Spirit** — a stylized voxel/low-poly figure
  generated locally from the card art (silhouette extrusion + palette from the
  artwork; no Nintendo model files, no downloads). Appears on the Den pedestal
  with sparkle burst + cry-style chime.
- **Headband**: every summon wears a tiny championship headband generated from
  card metadata — set symbol, release year, and set logo text (e.g. "EVOLVING
  SKIES · 2021 · #215/203"), rendered from our own data as a texture.
- **Condition = character**: mint card → glossy figure with sparkle aura;
  played/damaged card → dusty texture, bandage, **black eye + squint** 😅;
  graded 10 → gold pedestal and trophy pose.
- **Stage 2 (BYOK)**: optional image-to-3D via the user's own gen-AI key for a
  richer one-off figure, cached locally.
- **IP line**: fan-made stylized figures for personal viewing are the safest
  possible lane, but figures must NEVER ship as sellable assets/prints. The
  public build's default is "Card Spirit" abstractions; anything closer to real
  Pokémon designs stays personal-build only. (LEGAL.md governs.)

## 4 · Store strategy — honest map

| Target | Verdict | Path |
|--------|---------|------|
| **macOS (DMG, direct)** | ✅ live today | `dmg-latest` release; personal name OK because it's private distribution |
| **Mac App Store** | Possible | Needs rename + Apple Developer Program ($99/yr), sandboxing (the local Python server must move into the app or be replaced by Rust/JS), notarization (real cert — you have "Apple Development: Brandon Barkey") |
| **iOS App Store** | Possible (Tauri 2 supports iOS; your `tauri.conf.json` already has a `developmentTeam`) | Same rename + review rules; camera scanning is the hero feature there |
| **Google Play** | Possible | Tauri Android target; same rename rules |
| **Steam** | Plausible as **"The Amber Den"** — a cozy 3D collection-den app (any TCG, no Pokémon branding) | $100 Steam Direct fee; ship the Den/3D experience as the product, importing any CSV/collection |
| **Nintendo Switch** | ❌ Not realistic — closed platform, Nintendo licensing required, and a Pokémon-adjacent fan app would never pass. The Steam build is the way to get it on a TV. | — |

**Gate to "objectively acceptable to publish" (the routine works this list):**
- [ ] Ship-name chosen + swapped — the swap is now **one command**: `bash scripts/rename.sh "Card Den"` ✅ tool ready 2026-07-20 (still needs Brandon to pick the name)
- [x] LEGAL.md surfaced in-app (About panel) ✅ 2026-07-19
- [x] Replace scraped/linked card art default with user-scanned images or a
      licensed/open source in the public build — `publicArt` build flag
      (`data/build-flags.json`; CI `public_art` dispatch input) suppresses all
      external catalog art in ship builds ✅ 2026-07-21
- [x] Server hardening pass ✅ 2026-07-24 — static server now refuses
      `settings.local.json`, `lan-tls/` (TLS private key), the raw `.xlsx`
      export, and every dot-path (`.git/` was previously servable); security
      headers (nosniff / frame-deny / no-referrer) on every response; request
      bodies capped at 48 MB; and admin surfaces (Keychain secrets, Emerald
      subprocess runners, Finder reveals, key writes, LAN on/off, imports)
      are loopback-only — a phone on LAN mode can browse & scan but never
      administer. Verified with a real LAN-peer simulation: 12/12 admin
      probes 403'd, 6/6 browse/scan paths still 200, keys unwritable.
- [x] Crash/error reporting opt-in, privacy policy page ✅ 2026-07-25 —
      local-only opt-in error log (⚙ Live checkbox, off by default, capped at
      100 entries, never transmitted automatically) with a Copy/Send/Clear
      panel in Admin; LEGAL.md (surfaced in-app via the About panel) gained
      an explicit `## Privacy` section.
- [x] Onboarding for people with zero PriceCharting history — the Dashboard now
      shows a 3-path welcome panel (import .xlsx / connect live / add by hand)
      when the collection is empty ✅ 2026-07-24
- [x] Strip App-Store-blocking features from ship builds ✅ 2026-07-28 —
      `shipBuild` flag in `data/build-flags.json` (bundle-only, not
      user-overridable) removes the **Emerald Lab** from the UI *and* 404s
      its `/api/emerald/*` routes. It compiles the pokeemerald decompilation
      and runs an emulator: automatic rejection under guidelines 2.5.2 / 4.7.
      Remaining store blockers: the IP rename, and sandboxing the bundled
      Python server (see §4 — direct notarized distribution avoids the latter).
- [x] Release integrity ✅ 2026-08-01 — every `dmg-latest` build now publishes
      `SHA256SUMS.txt` and `OPEN-ANYWAY.command` alongside the dmg and source
      zip, and the release notes carry the Gatekeeper steps plus a
      `shasum -a 256 -c` line. Also fixed a latent CI bug: the build-profile
      step overwrote `data/build-flags.json` wholesale, so a `public_art`
      dispatch silently dropped `shipBuild` — it merges now, and `ship_build`
      is its own dispatch input.
- [x] Installable mobile format ✅ 2026-08-01 — the app is a PWA:
      `manifest.webmanifest`, a conservative service worker (never caches
      `/api/*`, network-first on `/data/*`, stale-while-revalidate for the
      shell, no cross-origin interception), maskable icons, and the four
      iOS-only meta tags Safari needs. Add it to an iPhone home screen from
      Scanner → Phone mode and it launches fullscreen and opens offline. Not a
      native iOS build — that still needs Xcode on the Mac and a paid
      membership — but it's the real mobile format today.
- [x] Accessibility pass ✅ 2026-08-01 — the tab strip is a proper ARIA
      tablist with roving tabindex and arrow-key navigation, views are
      labelled tabpanels, modals get dialog semantics + focus trap + Escape +
      focus restore via one MutationObserver (no edits to a dozen call sites),
      plus a skip link, focus-visible rings on every interactive surface, and
      `prefers-reduced-motion`.
- [x] App Store submission paperwork ✅ 2026-08-01 (partial) —
      `src-tauri/PrivacyInfo.xcprivacy` (required since 2024; declares no
      tracking, no collected data, and the three required-reason APIs) and
      `STORE-LISTING.md` (description, keywords, App Privacy answers, App
      Review notes covering the loopback server and opt-in LAN mode, screenshot
      shot-list, pre-submission checklist). Stays partial until the name is
      picked — every listing string is still `<APP>`.
- [ ] Real signing + notarization in CI (needs Apple cert secrets in repo)
- [x] Top-5 backlog features above implemented ✅ 2026-08-01 — bulk binder scan
      (#1), AI pre-grade (#2), price alerts (#3), per-card history charts (#4)
      and set completion (#5) all shipped; trade checker (#6) landed with them.
- [ ] Beta round (TestFlight / direct DMG) with 5–10 collectors

## 5 · Open questions for Brandon

1. **"Goldgate"** — you mentioned pushing "through Goldgate app here on mac":
   I don't know this one and can't see your Mac from the cloud session. Is it a
   publishing tool / a typo (Gatekeeper? Codegate?)? Tell me what it is and I'll
   wire the pipeline to it.
2. **Ship name**: shortlist is **Vitrine** / **Longbox** / **Compsheet** (§1) —
   pick one, or veto the batch and I'll go again from a different angle.
3. **Audience for v1 public**: sellers (current strength) or collectors
   (set-completion/scanning)? Decides which backlog features go first.
4. **Apple Developer Program**: you have a development cert — do you also have a
   paid membership (needed for notarization/TestFlight/App Store)?
5. **Pricing**: free + BYOK forever, one-time purchase, or subscription for the
   cloud-sync tier?
6. **Multi-TCG now or later?** Your export already has non-Pokémon games in it.
7. **Cloud sync**: comfortable running a small backend (accounts, sync), or
   keep local-only + iCloud-file sync?
8. **Steam "Amber Den" build**: green-light exploring it as a separate,
   IP-clean product?
9. **The Summon**: OK shipping only the abstract "Card Spirit" style publicly?
10. **PriceCharting**: fallback is solid; want me to email PC about official
    partner/API terms for a shipped app?
