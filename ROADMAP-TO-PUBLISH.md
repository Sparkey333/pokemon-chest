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
invites a Nintendo C&D. Personal build keeps **Pokémon Den**; for shipping, the
strongest safe candidates (all keep the Den/3D identity):

| Name | Why it works | Check before committing |
|------|--------------|------------------------|
| **Card Den** ⭐ recommended | Short, ownable, ties the 3D Den + multi-TCG future (Magic/sports already in your export) | USPTO + App Store search, carddow?.com/cardden.app domain |
| **The Amber Den** | Your own DarkHearts world — real brand equity, zero IP risk | You already own the concept; check app-store name collision |
| **DenKeeper** | One word, verb-y, "keeper of the den/collection" | Domain + trademark |
| **Collector's Den** | Instantly clear to shoppers | More generic, harder to trademark |
| **Vaulted** / **Chestbound** | Punchy backups from Brand Lab | Both need clearance |

Mechanics: the display name is a plain string everywhere (one `sed` swap —
internal ids stay `pokechest.*` forever for data compatibility). Ship builds can
rename in one commit.

## 2 · Researched feature backlog (competitor + community sweep)

Sources: Collectr, Dex, Shiny, PullVault, PokéVault, CollectorVault, CollX,
pkmn.gg, Eyevo, PriceCharting app reviews, and app-store/blog comparisons
(see links in the PR). The 12 most-agreed-on wants, ranked by demand × fit:

1. **Bulk binder-page scan** ✅ 2026-07-24 — read all 9 cards of a binder page in
   one photo (PullVault's killer feature; #1 complaint about single-card
   scanners). Shipped in Scanner: 🗂 Scan a 9-pocket binder page.
2. **AI condition pre-grade from photos** — centering/corners/edges/surface
   estimate + grade-ROI verdict (CollectorVault/PokéVault do this; pairs
   perfectly with our Grade Lab break-even math and GradeStage rig).
3. **Price alerts** — per-card/slab thresholds and "top mover" pushes
   (Shiny/PokéVault). *Fit: PC sync already fetches prices; add thresholds +
   notification (menu-bar/badge locally, push later).*
4. **Per-card price history charts** — every app gets dinged for missing
   real-time collection growth (Dex reviews). *Fit: PC sync snapshots per card
   over time; chart in the card modal.*
5. **Set completion tracker** — master-set progress bars, missing-card list,
   cost-to-complete (Pokellector/pkmn.gg's core loop; we have full set data).
6. **Trade checker** — two stacks side-by-side with live values and a fairness
   verdict (PokéVault). Great for live streams too.
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
- [ ] Server hardening pass (already local-only; audit LAN mode defaults)
- [ ] Crash/error reporting opt-in, privacy policy page
- [x] Onboarding for people with zero PriceCharting history — the Dashboard now
      shows a 3-path welcome panel (import .xlsx / connect live / add by hand)
      when the collection is empty ✅ 2026-07-24
- [ ] Real signing + notarization in CI (needs Apple cert secrets in repo)
- [ ] Top-5 backlog features above implemented
- [ ] Beta round (TestFlight / direct DMG) with 5–10 collectors

## 5 · Open questions for Brandon

1. **"Goldgate"** — you mentioned pushing "through Goldgate app here on mac":
   I don't know this one and can't see your Mac from the cloud session. Is it a
   publishing tool / a typo (Gatekeeper? Codegate?)? Tell me what it is and I'll
   wire the pipeline to it.
2. **Ship name**: Card Den, The Amber Den, DenKeeper — pick one (or veto all)?
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
