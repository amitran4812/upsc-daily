# UPSC Daily – current affairs web app

A web app (installable on Android tablets and phones as an app) that every day:

1. Reads **PIB** press releases and **The Hindu** (National, International, Economy, Science,
   Environment, Health, Agriculture, Editorial, Op-Ed) through their official RSS feeds.
2. Keeps only UPSC-relevant items and classifies each one by **subject**, **GS paper (GS1–GS4 /
   Prelims facts)**, **stage (Prelims / Mains / both)** and **importance (High / Medium / Low)**,
   scoring them against recurring previous-year-question themes from 2013–2025.
3. Writes notes (summary, Prelims pointers, Mains angle, practice question) and builds **one PDF
   per day**, kept in a PDF archive.
4. Publishes a **monthly Prelims-style quiz** on the 1st of each month and notifies users.

Users sign in with a username and password; saved items, quiz scores and AI settings sync across
every device and browser they use. Each user can add their own **Claude, Gemini or ChatGPT** API
key to get AI-written notes and a PDF with those notes.

Copyright note: The Hindu items show only the short RSS excerpt plus a link to the full article.
PIB content is government material from pib.gov.in.

## Run locally

```bash
pip install -r requirements.txt
python run.py            # open http://127.0.0.1:8765
```

## Deploy (Railway, Docker)

1. Create a project from this folder (Dockerfile is detected).
2. Add a **Volume** mounted at `/data` (stores the database and PDFs).
3. Optional variables:
   - `CLAUDE_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY`: a site-wide key that writes the shared
     daily notes and monthly quiz with AI (otherwise built-in rule-based notes are used).
   - `UPSC_FETCH_HOUR` (default 7, IST). A second pass runs at 19:30 IST.
4. Open the public URL, create an account, and on the tablet use the browser menu →
   **Install app / Add to Home screen**.

## Adding your own previous-year questions

Put `.json` (list of `{"year": 2023, "paper": "GS2", "question": "..."}`) or `.csv`
(`year,paper,question`) files in `/data/pyq/` and restart. Matching PYQs then appear under each
news item and raise its importance.
