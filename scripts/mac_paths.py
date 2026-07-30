#!/usr/bin/env python3
"""
Mac / iCloud path helpers for Pokémon Chest
===========================================
After Desktop/Documents (or the whole project) migrate into iCloud Drive,
PriceCharting exports and writable app state can land in awkward places:

  ~/Library/Mobile Documents/com~apple~CloudDocs/…
  ~/Desktop, ~/Documents, ~/Downloads  (often firmlinks into iCloud)
  ~/Library/Application Support/PokemonChest  (safe local writable home)

This module finds those folders, locates PriceCharting .xlsx exports, detects
cloud-only placeholders (*.icloud), and picks a writable POKECHEST_HOME when
the checkout itself lives inside iCloud.
"""
from __future__ import annotations

import os
import shutil
import sys
from typing import List, Optional, Tuple

APP_SUPPORT_NAME = "PokemonChest"


def expand(p: str) -> str:
    return os.path.abspath(os.path.expanduser(p))


def icloud_drive() -> Optional[str]:
    """Return the iCloud Drive root if it exists on this Mac."""
    p = expand("~/Library/Mobile Documents/com~apple~CloudDocs")
    return p if os.path.isdir(p) else None


def is_under_icloud(path: str) -> bool:
    """True when path lives inside Apple's iCloud Drive container."""
    try:
        real = os.path.realpath(path)
    except OSError:
        real = os.path.abspath(path)
    markers = (
        "/Library/Mobile Documents/",
        "/Mobile Documents/com~apple~CloudDocs",
        "com~apple~CloudDocs",
    )
    low = real.replace("\\", "/")
    return any(m in low for m in markers)


def default_app_support() -> str:
    return expand(f"~/Library/Application Support/{APP_SUPPORT_NAME}")


def resolve_writable_home(root: str, env_home: Optional[str] = None) -> Tuple[str, str]:
    """
    Decide where writes go.

    Returns (home_path, reason). If POKECHEST_HOME is set, that wins.
    If the project root is inside iCloud, prefer Application Support so
    settings / rebuilt JSON / card-art don't fight iCloud placeholders.
    """
    env = (env_home if env_home is not None else os.environ.get("POKECHEST_HOME") or "").strip()
    if env:
        return os.path.abspath(env), "POKECHEST_HOME env"
    root = os.path.abspath(root)
    if is_under_icloud(root):
        home = default_app_support()
        return home, "project is in iCloud → Application Support"
    return root, "project folder"


def seed_home_from_root(home: str, root: str) -> List[str]:
    """
    One-time copy of critical files from the iCloud checkout into the local
    writable home so the app keeps working after migration.
    Never overwrites newer files in home.
    """
    copied: List[str] = []
    if os.path.abspath(home) == os.path.abspath(root):
        return copied
    os.makedirs(home, exist_ok=True)
    os.makedirs(os.path.join(home, "data"), exist_ok=True)

    def _copy_if_needed(rel: str) -> None:
        src = os.path.join(root, rel)
        dst = os.path.join(home, rel)
        if not os.path.isfile(src):
            return
        if os.path.isfile(dst):
            try:
                if os.path.getmtime(dst) >= os.path.getmtime(src):
                    return
            except OSError:
                return
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        try:
            shutil.copy2(src, dst)
            copied.append(rel)
        except OSError:
            pass

    for rel in (
        "settings.local.json",
        "data/collection.json",
        "data/codex.json",
        "data/selling-intel.json",
        "data/grade-intel.json",
        "data/game-plan.json",
    ):
        _copy_if_needed(rel)

    # Seed a PriceCharting export into home if home has none but root does.
    try:
        root_xlsx = [
            f for f in os.listdir(root)
            if f.lower().endswith(".xlsx") and not f.startswith("~$")
            and "pricecharting" in f.lower()
        ]
    except OSError:
        root_xlsx = []
    try:
        home_xlsx = [
            f for f in os.listdir(home)
            if f.lower().endswith(".xlsx") and not f.startswith("~$")
        ]
    except OSError:
        home_xlsx = []
    if root_xlsx and not home_xlsx:
        newest = max((os.path.join(root, f) for f in root_xlsx), key=os.path.getmtime)
        try:
            shutil.copy2(newest, os.path.join(home, os.path.basename(newest)))
            copied.append(os.path.basename(newest))
        except OSError:
            pass
    return copied


def _safe_listdir(d: str) -> List[str]:
    try:
        return os.listdir(d)
    except OSError:
        return []


def _walk_shallow(root: str, max_depth: int = 2) -> List[str]:
    """List directories under root up to max_depth (root = depth 0)."""
    out = [root]
    if max_depth <= 0 or not os.path.isdir(root):
        return out
    stack = [(root, 0)]
    while stack:
        cur, depth = stack.pop()
        if depth >= max_depth:
            continue
        for name in _safe_listdir(cur):
            if name.startswith("."):
                continue
            # Skip huge / irrelevant trees
            if name in ("node_modules", "Library", "Applications", "System",
                        "target", ".git", "cache", "card-art", "listing-photos"):
                continue
            p = os.path.join(cur, name)
            if os.path.isdir(p) and not os.path.islink(p):
                out.append(p)
                stack.append((p, depth + 1))
    return out


def search_roots(project_root: str, home: Optional[str] = None) -> List[str]:
    """Folders (and shallow children) to scan for PriceCharting exports."""
    roots: List[str] = []
    seen: set = set()

    def add(p: Optional[str], shallow: int = 0) -> None:
        if not p:
            return
        p = os.path.abspath(p)
        if p in seen or not os.path.isdir(p):
            return
        for d in _walk_shallow(p, shallow):
            if d not in seen:
                seen.add(d)
                roots.append(d)

    if home:
        add(home, 0)
    add(project_root, 1)

    # Classic Mac folders (often redirected into iCloud)
    for rel in ("~/Downloads", "~/Desktop", "~/Documents"):
        add(expand(rel), 1)

    ic = icloud_drive()
    if ic:
        add(ic, 0)
        # Common user drop spots inside iCloud Drive
        for name in (
            "Downloads", "Desktop", "Documents",
            "pokemon-chest", "Pokemon Chest", "Pokémon Chest",
            "PokemonChest", "TCG", "Cards", "PriceCharting",
        ):
            add(os.path.join(ic, name), 1)
        # One extra level under Documents / Desktop for nested project folders
        for name in ("Documents", "Desktop"):
            add(os.path.join(ic, name), 2)

    # Other cloud providers mounted via macOS Sequoia CloudStorage
    cloud_storage = expand("~/Library/CloudStorage")
    if os.path.isdir(cloud_storage):
        for name in _safe_listdir(cloud_storage):
            base = os.path.join(cloud_storage, name)
            add(base, 1)
            for sub in ("Downloads", "Desktop", "Documents"):
                add(os.path.join(base, sub), 1)

    return roots


def find_icloud_placeholders(dirs: List[str]) -> List[str]:
    """Return *.icloud stub paths that look like PriceCharting exports."""
    stubs = []
    for d in dirs:
        for f in _safe_listdir(d):
            low = f.lower()
            if low.endswith(".icloud") and "pricecharting" in low and ".xlsx" in low:
                stubs.append(os.path.join(d, f))
    return stubs


def try_materialize_icloud(path: str) -> bool:
    """
    Ask macOS to download a cloud-only file. Best-effort; returns True if the
    real file appears (or already exists without the .icloud suffix).
    """
    # Placeholder names look like: .PriceCharting….xlsx.icloud
    real = path
    base = os.path.basename(path)
    if base.startswith(".") and base.endswith(".icloud"):
        # .Foo.xlsx.icloud → Foo.xlsx
        real = os.path.join(os.path.dirname(path), base[1:-len(".icloud")])
    if os.path.isfile(real) and not real.endswith(".icloud"):
        return True
    # brctl download works on the parent folder or the placeholder
    for target in (path, os.path.dirname(path), real):
        try:
            import subprocess
            subprocess.run(
                ["brctl", "download", target],
                capture_output=True, timeout=30, check=False,
            )
        except Exception:
            pass
    return os.path.isfile(real) and os.path.getsize(real) > 0


def find_pricecharting_xlsx(project_root: str, home: Optional[str] = None) -> Tuple[Optional[str], dict]:
    """
    Newest PriceCharting .xlsx across Mac + iCloud search roots.
    Returns (path_or_None, diagnostics).
    """
    dirs = search_roots(project_root, home)
    files: list[str] = []
    stubs = find_icloud_placeholders(dirs)
    for stub in stubs:
        try_materialize_icloud(stub)

    for d in dirs:
        for f in _safe_listdir(d):
            if f.startswith("~$"):
                continue
            low = f.lower()
            if low.endswith(".xlsx"):
                files.append(os.path.join(d, f))

    named = [p for p in files if "pricecharting" in os.path.basename(p).lower()]
    if not named:
        # Any .xlsx only inside project / home (never random Downloads junk)
        own = {os.path.abspath(x) for x in ([home] if home else []) + [project_root]}
        named = [p for p in files if os.path.dirname(p) in own]

    # Prefer readable, non-empty files
    readable = []
    for p in named:
        try:
            if os.path.isfile(p) and os.path.getsize(p) > 0:
                readable.append(p)
        except OSError:
            continue

    best = max(readable, key=os.path.getmtime) if readable else None
    diag = {
        "searchedDirs": len(dirs),
        "xlsxFound": len(files),
        "pricechartingNamed": len(named),
        "icloudPlaceholders": stubs,
        "icloudDrive": icloud_drive(),
        "chosen": best,
    }
    return best, diag


def path_report(project_root: str, home: Optional[str] = None) -> dict:
    """Structured diagnostics for /api/health and fix-icloud.command."""
    root = os.path.abspath(project_root)
    resolved_home, reason = resolve_writable_home(root, home if home is not None else None)
    # If caller already fixed HOME, use that for the report
    if home:
        resolved_home = os.path.abspath(home)
        reason = "POKECHEST_HOME env" if (os.environ.get("POKECHEST_HOME") or "").strip() else reason
    xlsx, diag = find_pricecharting_xlsx(root, resolved_home)
    coll_home = os.path.join(resolved_home, "data", "collection.json")
    coll_root = os.path.join(root, "data", "collection.json")
    return {
        "projectRoot": root,
        "projectInICloud": is_under_icloud(root),
        "writableHome": resolved_home,
        "homeReason": reason,
        "icloudDrive": icloud_drive(),
        "collectionInHome": os.path.isfile(coll_home),
        "collectionInProject": os.path.isfile(coll_root),
        "pricechartingXlsx": xlsx,
        "search": {k: v for k, v in diag.items() if k != "chosen"},
        "macosFolders": {
            "Downloads": os.path.isdir(expand("~/Downloads")),
            "Desktop": os.path.isdir(expand("~/Desktop")),
            "Documents": os.path.isdir(expand("~/Documents")),
            "ApplicationSupport": os.path.isdir(default_app_support()),
        },
    }


def deliver_destinations(filename: str) -> List[Tuple[str, str]]:
    """
    (label, path) targets for mobile/deck HTML delivery.
    Order: Desktop, iCloud Drive root, iCloud Desktop, Documents.
    """
    out: List[Tuple[str, str]] = []
    desk = expand("~/Desktop")
    if os.path.isdir(desk):
        out.append(("Desktop (AirDrop it)", os.path.join(desk, filename)))
    ic = icloud_drive()
    if ic:
        out.append(("iCloud Drive (Files app on iPhone)", os.path.join(ic, filename)))
        ic_desk = os.path.join(ic, "Desktop")
        if os.path.isdir(ic_desk) and os.path.realpath(ic_desk) != os.path.realpath(desk):
            out.append(("iCloud Desktop", os.path.join(ic_desk, filename)))
        ic_docs = os.path.join(ic, "Documents")
        if os.path.isdir(ic_docs):
            out.append(("iCloud Documents", os.path.join(ic_docs, filename)))
    docs = expand("~/Documents")
    if os.path.isdir(docs):
        out.append(("Documents", os.path.join(docs, filename)))
    return out


if __name__ == "__main__":
    # CLI: python3 scripts/mac_paths.py [project_root]
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(__file__)))
    home, why = resolve_writable_home(root)
    seeded = seed_home_from_root(home, root)
    import json
    report = path_report(root, home)
    report["seeded"] = seeded
    report["homeReason"] = why
    print(json.dumps(report, indent=2))
    if not report.get("pricechartingXlsx"):
        stubs = report.get("search", {}).get("icloudPlaceholders") or []
        if stubs:
            print("\n⚠️  Found iCloud placeholders (not downloaded yet):", file=sys.stderr)
            for s in stubs:
                print(f"   {s}", file=sys.stderr)
            print("   Open them in Finder (or Files) once so macOS downloads the real .xlsx.", file=sys.stderr)
        sys.exit(2)
