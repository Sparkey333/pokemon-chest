---
name: gitkit
description: >-
  Pokémon Chest release kit — sync latest sources, rebuild the universal macOS
  DMG + source zip via GitHub Actions, publish the rolling chest-latest release
  (with download buttons), download artifacts locally, and reduce Gatekeeper
  suspicion. Use when the user says /gitkit, asks to refresh the DMG/Tauri
  build, publish chest-latest, re-download release assets, or harden macOS
  Gatekeeper / signing / notarization for this repo.
---

# /gitkit — Pokémon Chest release kit

Automate the loop: **sync → build → publish → download → unlock**.

## When to run

- User says `/gitkit` or “refresh the DMG / source / Tauri build”
- After feature work that should land on [chest-latest](https://github.com/Sparkey333/pokemon-chest/releases/tag/chest-latest)
- Gatekeeper “Not Opened / Done only” questions after a new DMG

## Prerequisites

- Repo: `Sparkey333/pokemon-chest` (working tree usually `/workspace`)
- Preferred feature branch prefix: `cursor/<name>-8306`
- Rolling release tag: **`chest-latest`** (do **not** overwrite Den’s `dmg-latest`)
- Workflow: `.github/workflows/build-dmg.yml`
- Download guide: `GET-POKEMON-CHEST.html` (buttons resolve the live DMG name via GitHub API)

## Procedure (do in order)

### 1. Sync to latest

```bash
git fetch --all --tags --force
git status -sb
# Compare feature branch vs origin/main and any redesign branch for newer files.
# Prefer cherry-picking Chest-compatible pieces; do NOT wholesale-merge Den branding.
gh release view chest-latest
gh run list --workflow=build-dmg.yml --limit 5
```

If local commits are behind `origin/<branch>`, pull. If `main` has commits you need, rebase/merge carefully.

### 2. Version bump (when shipping)

Bump in lockstep:

- `package.json`
- `server.py` → `VERSION`
- `assets/app.js` → `APP_VERSION`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` + `Cargo.lock` (`name = "pokemon-chest"`)

Update `GET-POKEMON-CHEST.html` fallback DMG filename + footer version. CI release notes read `package.json` version automatically.

### 3. Trigger the universal DMG build

Pushing to a watched branch with changes under `assets/`, `src-tauri/`, `server.py`, etc. triggers CI. Or:

```bash
gh workflow run build-dmg.yml --ref "$(git branch --show-current)"
gh run watch  # wait for the newest run of this workflow
```

CI builds **universal-apple-darwin**, ad-hoc signs (`signingIdentity: "-"`), and republishes **`chest-latest`** with:

| Asset | Purpose |
|-------|---------|
| `Pokemon.Chest_<ver>_universal.dmg` | Mac installer |
| `PokemonChest-source-<sha7>.zip` | Exact commit source |
| `PokemonChest-source-latest.zip` | Stable download-button URL |
| `GET-POKEMON-CHEST.html` | One-page download + Gatekeeper guide |
| `OPEN-ANYWAY.command` | Clears quarantine + launches app |
| `SHA256SUMS.txt` | Checksums for verification |

### 4. Download here from GitHub (not from the runner workspace)

```bash
mkdir -p artifacts /opt/cursor/artifacts
cd artifacts
gh release download chest-latest --clobber
# optional mirror
cp -f * /opt/cursor/artifacts/ 2>/dev/null || true
shasum -a 256 -c SHA256SUMS.txt
```

Prefer **`gh release download`** so artifacts match what users get from the download buttons.

### 5. Secure / de-suspicious the DMG (Gatekeeper)

**Truth:** GitHub Actions in this repo currently **ad-hoc signs**. Sequoia will still show “Not Opened” until Open Anyway / `xattr` once. That is expected without notarization.

If CI fails with *“recent account payments have failed or your spending limit needs to be increased”*, macOS runners will not start. Then:

1. Fix GitHub **Billing & plans** for the account that owns the repo
2. Re-run `gh workflow run build-dmg.yml`
3. Meanwhile publish **source zip + guide + OPEN-ANYWAY + SHA256SUMS** with `gh release upload chest-latest … --clobber`, and keep the last good DMG on the release
4. Or build the DMG on a Mac: `./build-app.command`

**Immediate (always ship):**

1. Keep `OPEN-ANYWAY.command` + Gatekeeper section in `GET-POKEMON-CHEST.html` current.
2. Publish `SHA256SUMS.txt` so downloads can be verified.
3. On the Mac after install:

```bash
xattr -cr "/Applications/Pokemon Chest.app"
# or double-click OPEN-ANYWAY.command
```

**Local Mac build (cleaner than CI ad-hoc):**

- `tauri.conf.json` keeps `signingIdentity: "Apple Development: …"` for local `build-app.command`.
- CI **overrides** to `"-"` so unsigned runners still produce a DMG.

**Real “not suspicious” (requires secrets — do not fake):**

| Secret | Use |
|--------|-----|
| Developer ID Application cert + keychain / `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` | Sign for distribution |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarize + staple |

When those exist, extend `build-dmg.yml` to:

1. Import the cert into a temporary keychain
2. Build with `signingIdentity: "Developer ID Application: …"` and `hardenedRuntime: true`
3. `xcrun notarytool submit … --wait`
4. `xcrun stapler staple` the `.app` / `.dmg`
5. Publish the stapled DMG to `chest-latest`

Never claim a build is notarized unless stapler/notarytool succeeded.

### 6. PR / branch hygiene

- Commit + push the feature branch
- Open/update the PR against `main` (ManagePullRequest; `base_branch: main`)
- Do not publish Chest builds to the Den `dmg-latest` tag

## Quick checklist

- [ ] Fetched remotes / compared newer branches
- [ ] Version strings aligned
- [ ] CI `build-dmg.yml` green
- [ ] `chest-latest` has DMG + source-latest + guide + OPEN-ANYWAY + SHA256SUMS
- [ ] Artifacts downloaded via `gh release download` into `artifacts/`
- [ ] Checksums verified
- [ ] Gatekeeper unlock docs still accurate

## Related paths

- `.github/workflows/build-dmg.yml`
- `build-app.command` — local Tauri DMG
- `OPEN-ANYWAY.command` — quarantine clearer
- `GET-POKEMON-CHEST.html` — download buttons
- `fix-icloud.command` / `scripts/mac_paths.py` — post-iCloud path repair
- `scripts/pokechest-env.sh` — launcher bootstrap
