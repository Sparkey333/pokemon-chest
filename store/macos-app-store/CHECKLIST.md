# Mac App Store — checklist

Bundle id (keep): `com.darkhearts.pokemonchest`  
Suggested MAS display name: **Card Chest** (see `/STORE.md` IP note)  
Category: Lifestyle / Finance (Lifestyle preferred)  
Price: Paid Upfront (one-time), no auto-renewing IAP

## One-time setup

1. [ ] Apple Developer Program active (team id in `src-tauri/tauri.conf.json` → `WYUV6QMULK`)
2. [ ] App Store Connect → My Apps → **+** → macOS app
3. [ ] Create Mac App Distribution + Mac Installer Distribution certificates
4. [ ] Register App ID with hardened runtime capable entitlements
5. [ ] Decide final display name; update `productName` only for the MAS build flavor if needed

## Build flavor

GitHub CI today ships **Developer ID / ad-hoc DMG** to `chest-latest` (direct download).

For MAS you need a **Mac App Store** signed `.pkg` / `.app` with:

- `bundle.macOS.signingIdentity` = `3rd Party Mac Developer Application: …`
- App Store entitlements (sandbox if required for category — Tauri local-network / file access must be declared)
- Upload via **Transporter** or `xcrun altool` / `notarytool` + ASC

Do **not** overwrite the direct `chest-latest` DMG with a sandboxed MAS build — keep two channels.

## Listing copy (short)

**Subtitle:** Your card vault. One-time. On your Mac.

**Promotional text:**
Open Today and see the best next step — sell, grade, buy, refresh, or scan. Your collection stays on your Mac. No account. No subscription.

**Description:** see `listing.md`

## Screenshots (required)

Capture from the 1.16+ build:

1. Today — vault hero + Next steps
2. Vault (Collection) grid
3. Sell Hub with net-after-fees
4. Grade Lab pre-grade
5. Scanner

Sizes: 1280×800 and 2560×1600 (Mac)

## Privacy

- No account
- No tracking SDK
- Optional BYOK keys stored locally (`settings.local.json` / Keychain for secure inputs)
- Network: TCGdex images + optional PriceCharting / comps / AI when user pastes keys

Privacy policy URL: host a short page (GitHub Pages or darkhearts site) before submit.

## Submit

1. [ ] Archive MAS build on a Mac with certificates
2. [ ] Upload build to App Store Connect
3. [ ] Attach screenshots + review notes (“local collection advisor; PriceCharting export optional”)
4. [ ] Submit for Review
