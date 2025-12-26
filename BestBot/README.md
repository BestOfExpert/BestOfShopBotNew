# BestBot — Telegram Sales Bot

Quick notes to run and deploy this project (Railway recommended for persistent polling):

- Run locally:

```bash
npm install
# create a .env file from .env.example and set BOT_TOKEN
npm start
```

- Environment:
  - Set `BOT_TOKEN` in Railway environment variables (Project > Variables) before deploying.

- Deployment options:
  - Railway / Render / DigitalOcean App: run the bot as a persistent process (polling). Connect your GitHub repo and add `BOT_TOKEN` in the project settings. Use the existing `npm start` (`node index.js`).
  - Serverless platforms (Vercel): convert to webhook mode and move `products.json` to an external DB because serverless functions cannot persist file writes.

- Important notes for Railway (polling, recommended):
  - Railway runs a long-lived process so the current polling implementation (`polling: true`) works without change.
  - Ensure only a single Railway instance writes to `products.json`, otherwise stock race conditions may occur. Prefer using an external DB for concurrency.
  - Add `BOT_TOKEN` in Railway > Variables.

- Code pointers:
  - Entry point: [index.js](index.js#L1)
  - Bot logic and admin flow: [bot.js](bot.js#L1-L20)
  - Product data: [products.json](products.json#L1-L20)
  - Product descriptions: `descriptions/<product name>.txt` (filenames must match product keys exactly).

If you want, I can: (A) prepare a Dockerfile + `railway.json` for one-click Railway deploy, (B) migrate `products.json` to Supabase, or (C) add a small admin web UI to manage stock. Which should I do next?
