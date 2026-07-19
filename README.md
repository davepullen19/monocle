# Thames Lido watch — hosted free on GitHub Actions

Runs the Swim & Lunch availability checker on a schedule **in the cloud** (no need
for your Mac to be on) and emails you the moment availability for your date/party
**changes**. Free: public repos get unlimited Actions minutes.

## How it works
- `check.js` — drives the real SevenRooms widget in headless Chromium and reads the
  calendar (struck-through day = not bookable). Exit 0 = available, 1 = not.
- `watch.js` — runs the check, compares to the last result in `state.json`, and only
  emails on a **change**. Writes the new `state.json`.
- `.github/workflows/watch.yml` — runs `watch.js` every 30 min, emails via Gmail
  SMTP on change, and commits `state.json` back so the "last seen" value persists
  between runs.

## One-time setup

### 1. Create the repo and push this folder
```bash
cd gh-actions
git init
git add .
git commit -m "Thames Lido watcher"
gh repo create thameslido-watch --public --source=. --push
# (or make it on github.com and `git remote add origin ... && git push -u origin main`)
```
> **Public** repo = unlimited free minutes. A **private** repo works too but uses
> your 2,000 free min/month — if private, widen the cron interval (see below).

### 2. Add your email secrets
Repo → **Settings → Secrets and variables → Actions → Secrets → New repository secret**.
Add three (these are the same Gmail app-password values you already use locally):

| Secret name | Value |
|---|---|
| `SMTP_USER` | `dpullen19@gmail.com` |
| `SMTP_PASS` | your 16-char Gmail app password (no spaces) |
| `SMTP_TO`   | `dpullen19@gmail.com` |

Secrets are encrypted and never shown in logs — safe even in a public repo.

### 3. (Optional) change the target without editing code
Same page → **Variables** tab → add:

| Variable | Example |
|---|---|
| `WATCH_DATE`  | `2026-09-03` |
| `WATCH_PARTY` | `4,6` |

No variables set = defaults to **2026-08-31**, party **4,6**.

### 4. Turn it on
Repo → **Actions** tab → enable workflows if prompted. Open **Thames Lido watch** →
**Run workflow** to fire it once immediately. After that it runs on the schedule.

## Change the schedule
Edit the `cron` line in `.github/workflows/watch.yml` (times are **UTC**):
- `*/30 * * * *` → every 30 min (default)
- `*/15 * * * *` → every 15 min
- `0 * * * *`    → hourly (good for private repos to save minutes)

## Test / run locally
```bash
npm install
npx playwright install chromium
PLAYWRIGHT_CHANNEL=chrome node check.js --date 2026-08-31 --party 4,6 --month
```

## Notes & honest caveats
- GitHub may **delay** scheduled runs by a few minutes under load — great for
  "tell me within ~30 min," not for split-second sniping.
- The first run for a new date records a baseline and only emails if it's *already*
  available; after that you get an email whenever it flips available ⇄ not.
- `state.json` is committed by a bot each run (message tagged `[skip ci]`), which is
  normal and keeps the "last seen" value between runs.
