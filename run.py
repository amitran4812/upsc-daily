"""Run locally for development: python run.py  ->  http://127.0.0.1:8765"""
import os
import uvicorn

if __name__ == "__main__":
    os.environ.setdefault("SECURE_COOKIES", "0")   # plain http on localhost
    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", 8765)))
