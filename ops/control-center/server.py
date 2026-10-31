#!/usr/bin/env python3
"""Loop Control Center — local server (127.0.0.1:9123).

Serves the single-page console + a live /api/state (rebuilt per request) and a
POST /api/monitor toggle. Localhost-only by default. stdlib only, no build step.
"""
from __future__ import annotations
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import state_builder

HERE = Path(__file__).resolve().parent
INDEX = HERE / "index.html"
FLAG = Path.home() / ".claude" / "agent-chains" / "monitor.flag"
HOST, PORT = "127.0.0.1", 9123


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body: bytes, ctype):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/state"):
            try:
                st = state_builder.build()
                # emit a loop-<name> sensor for EVERY armed loop (not just the active one),
                # so an inactive loop's sensor never drifts stale between its turns.
                for _n in st.get("loop_names", []):
                    _ls = st.get("loops", {}).get(_n)
                    if _ls:
                        try:
                            state_builder.emit_sensor(_ls)
                        except Exception:
                            pass
                self._send(200, json.dumps(st).encode(), "application/json")
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")
        elif self.path in ("/", "/index.html"):
            self._send(200, INDEX.read_bytes() if INDEX.exists() else b"index.html missing", "text/html; charset=utf-8")
        elif self.path == "/healthz":
            self._send(200, b"ok", "text/plain")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path == "/api/monitor":
            n = int(self.headers.get("content-length", 0) or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except Exception:
                body = {}
            on = bool(body.get("on"))
            try:
                FLAG.parent.mkdir(parents=True, exist_ok=True)
                if on:
                    FLAG.write_text("on")
                elif FLAG.exists():
                    FLAG.unlink()
                self._send(200, json.dumps({"on": on}).encode(), "application/json")
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")
        elif self.path == "/api/atom":
            n = int(self.headers.get("content-length", 0) or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                ok = state_builder.mark_atom(str(body.get("id", "")), bool(body.get("done", True)))
                self._send(200, json.dumps({"ok": ok}).encode(), "application/json")
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")
        elif self.path == "/api/toggle_loop":
            # Turn a loop on/off by creating/removing its <name>.enabled marker (arb starts OFF).
            n = int(self.headers.get("content-length", 0) or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
                name = str(body.get("loop", "")).strip()
                on = bool(body.get("on"))
                if not re.fullmatch(r"[a-z0-9_-]{1,40}", name) or not (state_builder.CHAIN_DIR / f"{name}.chain.json").exists():
                    self._send(400, json.dumps({"error": "unknown loop"}).encode(), "application/json")
                    return
                marker = state_builder.CHAIN_DIR / f"{name}.enabled"
                if on:
                    marker.write_text("on")
                elif marker.exists():
                    marker.unlink()
                self._send(200, json.dumps({"loop": name, "on": on}).encode(), "application/json")
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")


if __name__ == "__main__":
    print(f"Loop Control Center → http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
