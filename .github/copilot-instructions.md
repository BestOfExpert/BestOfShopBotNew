<!-- Copilot instructions for BestBot repo -->
# BestBot — AI Coding Assistant Guide

This repository is a small Telegram sales bot written in Node.js. Use these notes to make focused, safe edits and add features quickly.

- **Entry point:** `index.js` loads `bot.js` (see [index.js](index.js#L1)). Run with `npm start` which runs `node index.js` (see [package.json](package.json#L1)).

- **Core behavior:** `bot.js` implements the entire bot logic using `node-telegram-bot-api` (see [bot.js](bot.js#L1-L20)). It uses polling, not webhooks.

- **Data model & product flow:** Products live in `products.json` as a nested map: category -> product name -> { price, stock }. The bot reads this file at runtime and writes back when stock changes. See examples in [products.json](products.json#L1-L20).

- **Descriptions:** Human-readable product descriptions are plain text files in the `descriptions/` folder. Filenames must match the product name exactly plus `.txt` (the code uses `${productName}.txt`), e.g., the product key `Cyrax Mod Haftalık - 400 TL` must correspond to `descriptions/Cyrax Mod Haftalık - 400 TL.txt`.

- **Admin flow & approval:** `ADMIN_ID` is a numeric constant in `bot.js`. Payment documents (photos/docs) are forwarded to `ADMIN_ID` and an inline approval button `approve_<userId>` triggers stock pop and delivery. Look at the `approve_` callback handler in [bot.js](bot.js#L60-L140).

- **File I/O patterns:** The bot reads/writes `products.json` synchronously (`fs.readFileSync` / `fs.writeFileSync`). When editing code that touches stock management, preserve current sync behavior or consciously refactor to async and update all call sites.

- **Secrets & tokens:** The Telegram bot token is currently hard-coded in `bot.js`. When adding features or PRs, prefer moving secrets to environment variables (not required here, but watch for accidental token commits).

- **Dependencies:** `node-telegram-bot-api` is used; `telegraf` is listed in `package.json` but unused. Confirm whether you intend to migrate before changing dependencies ([package.json](package.json#L1-L40)).

- **Conventions & gotchas:**
  - Product keys are used as filenames and as user-facing labels; avoid renaming product keys without updating `descriptions/` filenames and admin procedures.
  - Stock is an array of pre-generated keys; the code shifts one key on approval and writes the file immediately—concurrent approvals can race if the bot is clustered. This repo uses single-process polling so it's safe.
  - Markdown vs HTML: message formatting varies (`parse_mode` set to `Markdown` in most places, `HTML` in one delivery message). Mirror parse modes when modifying messages.

- **Quick tasks examples:**
  - Add a new product: update `products.json` (category + product object) and add matching `descriptions/<product>.txt`.
  - Change payment text: edit callback branches `pay_iban`, `pay_papara`, `pay_binance` in [bot.js](bot.js#L140-L220).

- **Testing & run commands:**
  - Start locally: `npm install` then `npm start`.
  - Runtime logs appear on STDOUT since the bot uses `console` via `node` (no logger configured).

If any of these sections are unclear or you'd like me to expand examples (e.g., exact product JSON schema, safe refactor to async I/O, or migrating token to env), tell me which part to update.
