Optional UI test. It runs the real public/app.js in jsdom against a live in-process server (dry-run mode) and walks the full flow: create profile, record trade, sell key, buy key, unlock, copy, revoke.

1. cd test-ui
2. npm install
3. npm test
