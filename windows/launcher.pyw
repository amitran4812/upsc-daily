"""Background launcher for Windows (run with pythonw, no console window).

Starts the portal on port 8765 for this PC and the home Wi-Fi, keeps a log,
and exits quietly if it is already running.
"""
import os, socket, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("LOCALAPPDATA", ROOT)) / "UPSCDaily" / "data"
DATA.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("UPSC_DATA_DIR", str(DATA))
os.environ.setdefault("SECURE_COOKIES", "0")      # plain http on the home network
PORT = int(os.environ.get("UPSC_PORT", 8765))

log = open(DATA / "portal.log", "a", buffering=1, encoding="utf-8")
sys.stdout = sys.stderr = log

with socket.socket() as s:
    if s.connect_ex(("127.0.0.1", PORT)) == 0:
        sys.exit(0)                                # already running

sys.path.insert(0, str(ROOT))
import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, log_config=None, access_log=False)
