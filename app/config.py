"""Static configuration: paths, feeds, schedule."""
from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("UPSC_DATA_DIR", BASE_DIR / "data"))
PDF_DIR = DATA_DIR / "pdfs"
PYQ_DIR = DATA_DIR / "pyq"          # drop your own PYQ .json/.csv files here
DB_PATH = DATA_DIR / "portal.db"
for d in (DATA_DIR, PDF_DIR, PYQ_DIR):
    d.mkdir(parents=True, exist_ok=True)

TIMEZONE = "Asia/Kolkata"
DAILY_FETCH_HOUR = int(os.environ.get("UPSC_FETCH_HOUR", 7))   # 07:00 IST
DAILY_FETCH_MINUTE = int(os.environ.get("UPSC_FETCH_MINUTE", 0))

USER_AGENT = "UPSC-CA-Portal/1.0 (personal study tool; RSS reader)"

# Only official RSS feeds are used. The Hindu items keep the short RSS excerpt
# and a link back to the article; full articles are never copied.
FEEDS = [
    # PIB: all English press releases (national)
    {"source": "PIB", "section": "Press Releases",
     "url": "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3"},
    # The Hindu sections most useful for UPSC
    {"source": "The Hindu", "section": "National",
     "url": "https://www.thehindu.com/news/national/feeder/default.rss"},
    {"source": "The Hindu", "section": "International",
     "url": "https://www.thehindu.com/news/international/feeder/default.rss"},
    {"source": "The Hindu", "section": "Economy",
     "url": "https://www.thehindu.com/business/Economy/feeder/default.rss"},
    {"source": "The Hindu", "section": "Science",
     "url": "https://www.thehindu.com/sci-tech/science/feeder/default.rss"},
    {"source": "The Hindu", "section": "Environment",
     "url": "https://www.thehindu.com/sci-tech/energy-and-environment/feeder/default.rss"},
    {"source": "The Hindu", "section": "Health",
     "url": "https://www.thehindu.com/sci-tech/health/feeder/default.rss"},
    {"source": "The Hindu", "section": "Agriculture",
     "url": "https://www.thehindu.com/sci-tech/agriculture/feeder/default.rss"},
    {"source": "The Hindu", "section": "Editorial",
     "url": "https://www.thehindu.com/opinion/editorial/feeder/default.rss"},
    {"source": "The Hindu", "section": "Lead (Op-Ed)",
     "url": "https://www.thehindu.com/opinion/lead/feeder/default.rss"},
]

MAX_EXCERPT_CHARS = 420        # short excerpt only
MIN_RELEVANCE = 2.0            # items below this score are dropped
MAX_ITEMS_PER_DAY = 60
