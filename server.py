#!/usr/bin/env python3
"""
Pokémon Chest local backend
===========================
Serves the static app AND proxies the optional BYOK live-data integrations so
your API keys never touch the browser and never hit CORS. With no keys set, the
app runs exactly as the free static version (TCGdex images + your export prices +
deep-links).

Designed to run both from a dev checkout AND bundled read-only inside a macOS
.app: set POKECHEST_HOME to a writable directory and ALL writes (settings,
rebuilt data, cache) go there; the bundle itself is never written to.

Keys live in settings.local.json (gitignored, never bundled). Endpoints:
  GET  /api/health            -> {ok:true, version}
  GET  /api/config            -> which integrations are configured (booleans only)
  POST /api/config            -> save keys / provider choices
  GET  /api/price?id=<pcId>   -> PriceCharting price+graded tiers for one card
  POST /api/comps             -> live sold comps (eBay/TCGplayer/JP) via a comps API
  POST /api/ai                -> a written sell/grade recommendation (Claude or OpenAI)
  POST /api/refresh           -> rebuild data/collection.json from the newest export
  GET  /data/collection.json  -> POKECHEST_HOME copy when present, else bundled file

Env:  POKECHEST_HOME (writable home; default: this script's directory)
      POKECHEST_PORT (port; POKEVAULT_PORT kept as a legacy fallback)

Run:  python3 server.py     (or double-click start.command)
"""
import os, sys, json, html, subprocess, urllib.request, urllib.error, urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.5.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.abspath(os.environ.get("POKECHEST_HOME") or ROOT)
SETTINGS = os.path.join(HOME, "settings.local.json")
PORT = int(os.environ.get("POKECHEST_PORT") or os.environ.get("POKEVAULT_PORT") or "8787")
POCKET_NAME = "Pokémon Chest — Pocket.html"

# ---------------------------------------------------------------- settings ---
def load_settings():
    try:
        with open(SETTINGS, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def save_settings(patch):
    s = load_settings()
    # only persist known keys; empty string clears one
    for k in ("pricecharting_token", "comps_provider", "comps_key",
              "ai_provider", "ai_key", "ai_model"):
        if k in patch:
            v = (patch[k] or "").strip()
            if v:
                s[k] = v
            else:
                s.pop(k, None)
    os.makedirs(HOME, exist_ok=True)  # writes always go to the writable home
    # owner-only from the first byte (no umask window), swapped in atomically
    tmp = SETTINGS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)
    os.replace(tmp, SETTINGS)
    return s

def config_view(s):
    return {
        "priceCharting": bool(s.get("pricecharting_token")),
        "comps": {"enabled": bool(s.get("comps_key")), "provider": s.get("comps_provider", "pokemonpricetracker")},
        "ai": {"enabled": bool(s.get("ai_key")), "provider": s.get("ai_provider", "anthropic"),
               "model": s.get("ai_model") or ("claude-fable-5" if s.get("ai_provider", "anthropic") == "anthropic" else "gpt-4o")},
    }

# ---------------------------------------------------------------- http util ---
def http_json(url, *, method="GET", headers=None, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def cents(v):
    try:
        return round(int(v) / 100.0, 2)
    except (TypeError, ValueError):
        return None

# ------------------------------------------------------------- integrations ---
def pricecharting_price(pc_id, token):
    """PriceCharting Product endpoint. Keys mirror the CSV price-guide columns;
    prices are integer pennies. Returns ungraded + graded tiers we can map."""
    url = f"https://www.pricecharting.com/api/product?{urllib.parse.urlencode({'t': token, 'id': pc_id})}"
    d = http_json(url)
    if d.get("status") == "error":
        return {"ok": False, "error": d.get("error-message", "PriceCharting error")}
    # CSV/price-guide column names → friendly tiers (graded columns reuse the
    # collectibles vocabulary; we surface the raw object too so nothing is lost).
    tiers = {
        "ungraded":  cents(d.get("loose-price")),
        "grade7to8": cents(d.get("complete-price") or d.get("cib-price")),
        "grade9":    cents(d.get("new-price")),
        "grade9_5":  cents(d.get("graded-price")),
        "psa10":     cents(d.get("box-only-price") or d.get("manual-only-price")),
    }
    return {"ok": True, "name": d.get("product-name"), "set": d.get("console-name"),
            "tiers": {k: v for k, v in tiers.items() if v is not None},
            "raw": d}

def comps_lookup(payload, settings):
    """Live sold comps via a Pokémon comps API (BYOK). Provider-agnostic shell —
    normalization finalized per provider once a real key is present."""
    provider = settings.get("comps_provider", "pokemonpricetracker")
    key = settings.get("comps_key")
    q = payload.get("q", "")
    if provider == "pokemonpricetracker":
        url = "https://www.pokemonpricetracker.com/api/v1/prices?" + urllib.parse.urlencode({"search": q})
        raw = http_json(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    elif provider == "pokemon-api":
        url = "https://www.pokemon-api.com/api/v1/cards?" + urllib.parse.urlencode({"q": q})
        raw = http_json(url, headers={"x-api-key": key, "Accept": "application/json"})
    else:
        return {"ok": False, "error": f"Unknown comps provider: {provider}"}
    return {"ok": True, "provider": provider, "raw": raw}

AI_SYSTEM = (
    "You are a sharp, honest Pokémon-card selling advisor. Given one card with its "
    "values and (optionally) live sold comps, give a tight recommendation: sell now vs "
    "hold, raw vs grade-first (name the cheapest sensible grader and rough break-even), "
    "and the single best venue for the most NET money after fees (eBay ~13.6%, "
    "TCGplayer/Mercari ~11%, Cardmarket cheapest in EU). Be concrete with numbers, 4-6 "
    "sentences, no fluff, never overpromise. End with one clear action."
)

AI_LISTING_SYSTEM = (
    "You write high-converting, honest eBay listings for trading cards and collectibles. "
    "Given item facts (name, set, number, language, condition, price, any pre-grade notes), "
    "return EXACTLY two parts separated by a line containing only '---':\n"
    "1) A keyword-optimized eBay title, 80 characters MAX (lead with the most-searched "
    "terms: franchise, card name, number, set, language, grade/condition; no filler words, "
    "no emoji, no ALL CAPS spam).\n"
    "2) A clean listing description: a strong opening line, a short bulleted facts block "
    "(set, number, year, language, condition as stated), a condition paragraph that is "
    "honest and only claims what the seller stated, and a closing block about careful "
    "packaging (penny sleeve + semi-rigid holder, bubble mailer, tracked shipping). "
    "Plain text only, no HTML. Never invent flaws or grades the seller didn't state; "
    "never guarantee a future PSA grade."
)

def ai_recommend(payload, settings):
    provider = settings.get("ai_provider", "anthropic")
    key = settings.get("ai_key")
    model = settings.get("ai_model") or ("claude-fable-5" if provider == "anthropic" else "gpt-4o")
    mode = payload.pop("mode", None) if isinstance(payload, dict) else None
    system = AI_LISTING_SYSTEM if mode == "listing" else AI_SYSTEM
    user = ("Item facts:\n" if mode == "listing" else "Card and context:\n") + json.dumps(payload, ensure_ascii=False, indent=2)
    if provider == "anthropic":
        d = http_json(
            "https://api.anthropic.com/v1/messages", method="POST",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            body={"model": model, "max_tokens": 900, "system": system,
                  "messages": [{"role": "user", "content": user}]})
        text = "".join(b.get("text", "") for b in d.get("content", []) if b.get("type") == "text")
        return {"ok": True, "provider": provider, "model": model, "text": text.strip()}
    elif provider == "openai":
        d = http_json(
            "https://api.openai.com/v1/chat/completions", method="POST",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            body={"model": model, "max_tokens": 900,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user}]})
        text = d["choices"][0]["message"]["content"]
        return {"ok": True, "provider": provider, "model": model, "text": text.strip()}
    return {"ok": False, "error": f"Unknown AI provider: {provider}"}

# ----------------------------------------------------------------- refresh ---
def refresh_data():
    """Rebuild collection data by running scripts/build_data.py as a subprocess.
    Always returns a JSON-able dict — {ok:true, report:{...}} or {ok:false, error}."""
    script = os.path.join(ROOT, "scripts", "build_data.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": f"builder not found: {script}"}
    env = dict(os.environ)
    env["POKECHEST_HOME"] = HOME
    try:
        os.makedirs(HOME, exist_ok=True)
        proc = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True, env=env, cwd=HOME, timeout=600)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "data rebuild timed out after 10 minutes"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    if proc.returncode != 0:
        lines = [l for l in (proc.stderr or proc.stdout or "").strip().splitlines() if l.strip()]
        msg = lines[-1] if lines else f"builder exited with code {proc.returncode}"
        if "openpyxl" in combined:
            msg += "  Hint: install it with:  pip3 install --user openpyxl"
        return {"ok": False, "error": msg}
    report = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("REPORT_JSON="):
            try:
                report = json.loads(line[len("REPORT_JSON="):])
            except Exception:
                report = None
    if not isinstance(report, dict):
        return {"ok": False, "error": "builder finished but produced no REPORT_JSON line"}
    build_pocket()  # keep the iPhone Pocket Edition in sync with fresh data
    return {"ok": True, "report": {
        "entries": report.get("entries"),
        "cards": report.get("cards"),
        "value": report.get("value"),
        "imagesMatched": report.get("imagesMatched"),
    }}

def build_pocket():
    """Regenerate the self-contained iPhone Pocket Edition HTML. Best-effort —
    never raises into a request handler."""
    script = os.path.join(ROOT, "scripts", "build_pocket.py")
    if not os.path.isfile(script):
        return {"ok": False, "error": "pocket builder not found"}
    env = dict(os.environ); env["POKECHEST_HOME"] = HOME
    try:
        proc = subprocess.run([sys.executable, script],
                              capture_output=True, text=True, env=env, cwd=HOME, timeout=120)
        if proc.returncode != 0:
            return {"ok": False, "error": (proc.stderr or proc.stdout or "pocket build failed").strip().splitlines()[-1]}
        out = os.path.join(HOME, "Pokémon Chest — Pocket.html")
        kb = os.path.getsize(out) // 1024 if os.path.isfile(out) else 0
        return {"ok": True, "file": "Pokémon Chest — Pocket.html", "kb": kb}
    except Exception as e:
        return {"ok": False, "error": str(e)}

# ----------------------------------------------------------------- handler ---
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):  # quieter console
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def _guard(self, ok, what):
        if not ok:
            self._json({"enabled": False, "needs": what}, 200)
            return False
        return True

    def _serve_file(self, fpath, ctype):
        """Serve a file from the writable home if it exists. Returns True if served."""
        if not os.path.isfile(fpath):
            return False
        try:
            with open(fpath, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return True
        except Exception:
            return False

    def _local_ok(self):
        """Reject API calls that don't come from this machine's own app.

        Host must be localhost (defeats DNS rebinding); if the browser attached
        an Origin header (it always does on cross-origin requests), it must be
        a localhost origin too (defeats cross-site requests from web pages).
        Non-browser local tools (curl) send no Origin and pass.
        """
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]").lower()
        if host not in ("127.0.0.1", "localhost", "::1"):
            self._json({"ok": False, "error": "forbidden: non-local request"}, 403)
            return False
        origin = (self.headers.get("Origin") or "").lower()
        if origin and not (origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:")
                           or origin in ("http://127.0.0.1", "http://localhost")):
            self._json({"ok": False, "error": "forbidden: cross-site request"}, 403)
            return False
        return True

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/") and not self._local_ok():
            return
        if path == "/api/health":
            return self._json({"ok": True, "version": VERSION})
        if path == "/api/config":
            return self._json(config_view(load_settings()))
        if path == "/data/collection.json":
            # Serve the rebuilt copy from the writable home when it exists;
            # otherwise fall through to the bundled static file.
            live = os.path.join(HOME, "data", "collection.json")
            if self._serve_file(live, "application/json"):
                return
        if path == "/" + POCKET_NAME or path == "/" + urllib.parse.quote(POCKET_NAME):
            # The iPhone Pocket Edition is a generated artifact in the writable
            # home (the bundle is read-only), so serve it from there.
            if self._serve_file(os.path.join(HOME, POCKET_NAME), "text/html; charset=utf-8"):
                return
            return self._json({"ok": False, "error": "Pocket Edition not generated yet — click Regenerate in the Admin tab."}, 404)
        if path == "/api/price":
            s = load_settings()
            if not self._guard(s.get("pricecharting_token"), "pricecharting_token"):
                return
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            pid = (qs.get("id") or [""])[0]
            try:
                return self._json(pricecharting_price(pid, s["pricecharting_token"]))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        return super().do_GET()  # static files

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if not self._local_ok():
            return
        try:
            payload = self._read_body()
        except Exception:
            return self._json({"ok": False, "error": "bad JSON body"}, 400)
        if path == "/api/config":
            return self._json(config_view(save_settings(payload)))
        if path == "/api/refresh":
            try:
                return self._json(refresh_data())
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/pocket":
            return self._json(build_pocket())
        if path == "/api/comps":
            s = load_settings()
            if not self._guard(s.get("comps_key"), "comps_key"):
                return
            try:
                return self._json(comps_lookup(payload, s))
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        if path == "/api/ai":
            s = load_settings()
            if not self._guard(s.get("ai_key"), "ai_key"):
                return
            try:
                return self._json(ai_recommend(payload, s))
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:400]
                return self._json({"ok": False, "error": f"{e.code} {detail}"}, 200)
            except Exception as e:
                return self._json({"ok": False, "error": str(e)}, 200)
        return self._json({"ok": False, "error": "not found"}, 404)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)  # binds here
    # Ensure the iPhone Pocket Edition exists in the writable home so the Admin
    # "Open Pocket Edition" link works on first launch of the bundled app.
    if not os.path.isfile(os.path.join(HOME, POCKET_NAME)):
        try:
            import threading
            threading.Thread(target=build_pocket, daemon=True).start()
        except Exception:
            pass
    print("┌──────────────────────────────────────────────┐")
    print(f"│  Pokémon Chest running → http://localhost:{PORT} │")
    print("│  Keep this window open. Close it to stop.    │")
    print("└──────────────────────────────────────────────┘")
    print(f"POKECHEST_READY port={PORT}", flush=True)
    server.serve_forever()
