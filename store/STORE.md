# Store publish kit — Pokémon Chest

Pokémon Chest is positioned as a **private vault you own**: one-time purchase (or free from source), no account, no subscription, data stays on the user’s machine.

This folder prepares listing copy, checklists, and packaging notes for the **top five storefronts** we recommend for that model.

## Recommended top 5 (priority order)

| # | Store | Why | Fit for “one-time vault” |
|---|-------|-----|---------------------------|
| 1 | **Mac App Store** | Default discovery for Mac users; Trust / Gatekeeper solved via Apple review | Paid Upfront or Free + optional tips; avoid IAP subscriptions |
| 2 | **Direct (Gumroad / Lemon Squeezy / own site)** | Highest margin; clearest “you own the binary” story; ships the GitHub DMG or notarized build | Best primary checkout for DRM-free ownership |
| 3 | **itch.io** | Indie-friendly, DRM-free, one-time pricing, wishlist + discovery | Excellent for collectors / hobby tools |
| 4 | **Microsoft Store** | Reach when the Windows Tauri target ships | Same one-time SKU; pair with Mac |
| 5 | **Steam** | Huge install base; tools & utilities can sell as one-time apps | Use “no Steam Deck verified” until tested; DRM-free preferred |

**Avoid as the primary model:** Setapp / subscription aggregators — they fight the “one-time vault” promise. Fine later as an *optional* channel, not the headline.

## What “publish” means here

| Channel | What we can automate in-repo | What you must do once |
|---------|------------------------------|------------------------|
| GitHub `chest-latest` | CI DMG + source + guide | Already live |
| Mac App Store | Metadata, screenshots checklist, entitlements notes, `productName` / bundle id | Apple Developer Program ($99/yr), App Store Connect app record, certificates, notarized/MAS build upload via Transporter / `xcrun altool` / `notarytool` |
| Gumroad / Lemon | Listing markdown + asset list | Create product, upload DMG, set price |
| itch.io | `store/itchio/` push butler script skeleton | itch account + `butler` login |
| Microsoft Store | Partner Center listing draft | Windows build + Partner Center |
| Steam | Steamworks checklist | Steamworks partner fee + depot upload |

**This environment cannot log into App Store Connect for you.** After credentials exist, follow `store/macos-app-store/CHECKLIST.md`.

## Branding / IP note (Apple review)

“Pokémon” in a public App Store name invites trademark scrutiny. For **Mac App Store** submission, prefer a clearable display name such as:

- **Card Chest** (recommended)
- **Collector’s Chest**
- **Vaulted Cards**

Keep internal ids (`com.darkhearts.pokemonchest`, localStorage keys) stable for data compatibility. Direct / itch / GitHub can keep “Pokémon Chest” for personal/hobby distribution; MAS should use the clearable name until counsel clears otherwise.

See `ROADMAP` / redesign notes historically recommending **Card Den** — same constraint.

## Suggested one-time pricing (starting point)

| Tier | Price | Includes |
|------|-------|----------|
| Vault | **$19–29** one-time | Full Mac app, local vault, Scanner, Sell/Grade, Arcade |
| Source | Free (GitHub) | Same features; DIY build |

Optional BYOK keys (PriceCharting / AI) stay customer-owned — never bundle paid API access into the SKU.

## Files in this kit

```
store/
  STORE.md                 ← this file (also mirrored at /STORE.md)
  macos-app-store/         ← App Store Connect listing + checklist
  direct/                  ← Gumroad / Lemon / website copy
  itchio/                  ← itch page + butler notes
  microsoft-store/         ← Partner Center draft
  steam/                   ← Steamworks draft
```

## Immediate next actions for Brandon

1. Enroll / confirm **Apple Developer Program** team `WYUV6QMULK` (already referenced in `tauri.conf.json` iOS block).
2. Decide MAS display name (**Card Chest** vs keep Pokémon Chest for direct only).
3. Create App Store Connect record + pricing.
4. Export **Developer ID Application** + **Mac App Distribution** certificates; add CI secrets for notarization (see `.cursor/skills/gitkit/SKILL.md`).
5. Create Gumroad + itch products pointing at notarized DMG (or `chest-latest` until notarized).
6. Screenshot pass: Today (Next steps), Vault, Sell, Grade, Scanner — 1280×800 and 2560×1600.
