# Deploy

## Public demo on Render (dry-run, free)

1. Push this repo to GitHub.
2. On render.com choose New, then Blueprint, pick the repo, and apply. `render.yaml` does the rest.
3. When it is live, open `https://<your-service>.onrender.com/api/health`. See: `{"ok":true,"mode":"dry-run"}`.
4. Check the whole flow against it: `BASE=https://<your-service>.onrender.com npm run smoke`.

Free instances sleep after inactivity, so the first request can take about a minute. Their disk is also temporary: profiles and trades vanish when the instance restarts. That is fine for a judge-facing demo, since every visitor starts from the empty state described in the README. For data that survives restarts, use a paid instance with a disk mounted at `/opt/render/project/src/data`.

## Testnet mode

See "Run it (testnet)" in the README. Set `KEYVIEW_MODE=testnet` and `KEYVIEW_CONTRACT=<account>` as environment variables.

## Never commit

`data/master.key` and `data/db.json` hold the encryption key and every trade. `.gitignore` excludes `data/`. Before pushing, run `git ls-files | grep -E "master.key|db.json"` and confirm it prints nothing.
