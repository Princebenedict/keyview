# KeyView

Confidential social trading on NEAR. Traders keep their strategy private and sell time-limited viewing keys. Anyone can see public PnL and risk. Only key holders can see the trades and thesis, and copy them through NEAR Intents.

Live demo: https://keyview-be1v.onrender.com

Track: Privacy and Private AI (secondary: Agent Economy).

## Two modes

| | Dry-run (default) | Testnet |
|---|---|---|
| Needs | Node 20+ | Node 20+, a deployed contract, a NEAR wallet |
| Identity | Manage token kept in the browser | NEAR wallet, NEP-413 signed message |
| Viewing key | Random bearer token, server-side record | On-chain grant on the KeyView contract, checked by `has_access` |
| Payment | Simulated | `buy_key` with an attached NEAR deposit, paid to the trader by the contract |
| Revoke | Button on the dashboard | `revoke(holder)` on the contract |

Both modes share the same gate code, public metrics and copy flow. Nothing is seeded: a fresh install shows empty states until you create data.


## Tabs

| Tab | What it does |
|---|---|
| Leaderboard | Public ranking with search and sort by PnL, win rate, drawdown or trade count. Click a trader for their public page. |
| Trader dashboard | Create or restore a profile, write a strategy, record trades, set key prices, see and revoke issued keys. |
| Analytics | Trader only. Best and worst trade, average win and loss, profit factor, key sales and revenue, and a trade log where you can delete trades. |
| My keys | Viewing keys you hold, time left, renew or remove. Flags saved keys the server no longer knows. |
| Copy tracker | Copies you tracked from traders you hold keys for. Mark each as executed or skipped and see the result at the trader's recorded prices. |
| Security | Who sees what, how it is enforced, TEE status, and a public payload inspector. |
| Settings | Theme and copy defaults, account and manage token, export your data, clear browser data, delete your profile. |

## Design

- `/` is the product page: animated wordmark, a flow-field background that bends around the cursor, an interactive "keyhole" card, a scroll-driven how-it-works diagram, a key countdown ring, and an honest status section.
- `/app` is the app, in the same visual language. Light and dark themes, switched in Settings.
- Motion respects `prefers-reduced-motion`. The page works without JavaScript for its content, and the canvas and animations are skipped when paused or off-screen.
- Fonts (Unbounded, Manrope, JetBrains Mono) are bundled in `public/fonts` under the SIL Open Font License, so the design renders offline. Licenses sit beside the files.
- Illustrations on the product page are labeled as illustrations. No fake traders, numbers or testimonials appear anywhere.

## Run it (dry-run)

No dependencies to install.

1. `npm start`
2. Open http://localhost:3000. You land on the product page. Click Launch app to open the app at http://localhost:3000/app.
3. `npm test` (18 tests)
4. With the server running: `npm run smoke`

### Judge walkthrough: do X, see Y

1. Open http://localhost:3000/app. See: an empty leaderboard and the badge "dry-run mode".
2. Trader dashboard, enter `alice.testnet`, Create profile. See: the dashboard with all metrics at n/a.
3. Save a strategy with a name, tagline and a private thesis.
4. Record two trades (long NEAR/USDC 4.00 to 4.40 at 50%, then short 4.40 to 4.60 at 50%). See: Total PnL +2.73%, win rate 50%, max drawdown -2.27%.
5. Under Sell viewing keys, set a 7 day price and save.
6. In an incognito window open the leaderboard, click alice.testnet. See: stats and curve, and a locked private panel. No pair, side, price or thesis anywhere.
7. Enter `bob.testnet`, pick the 7 day key, Buy. See: the private panel unlocks with the thesis and trades.
8. Copy this strategy, enter a budget, Build Intents orders. See: open and close legs as 1Click-shaped quote requests.
9. Trader window, Issued keys, Revoke.
10. Reload the follower window. See: "Your stored key was rejected: Viewing key is revoked".

## Run it (testnet)

The commands below use `cargo-near` and `near-cli-rs`. Their syntax changes between releases, so check `--help` if a command is rejected.

1. Build the contract: `cd contract && cargo near build non-reproducible-wasm`
2. Create a testnet account for the contract and deploy the wasm to it, calling `new` with `{}`.
3. Start the server: `KEYVIEW_MODE=testnet KEYVIEW_CONTRACT=<contract account> npm start`
4. Open http://localhost:3000 and use the Trader dashboard. Connect Meteor or HERE wallet. A trader account signs in, creates a profile, saves a strategy, records trades and calls `set_offer` from the wallet.
5. Connect a second account, open the trader page, Buy viewing key on-chain. See: the private panel unlocks. Only an account with an active grant passes `has_access`.
6. Trader dashboard, Revoke holder. See: the holder's next private request returns 403.

No browser wallet, for scripts and AI judges:

```
KEYVIEW_URL=http://localhost:3000 NEAR_ACCOUNT_ID=you.testnet NEAR_PRIVATE_KEY=ed25519:... npm run login
```

This signs the same NEP-413 challenge with a local key and prints a session token for `Authorization: Bearer <token>`. Grants can then be created with `near` CLI calls to `buy_key`.

Environment variables: see `.env.example`.

## What is verified, and what is not

Verified in the authoring sandbox:
- 18 Node tests: public/private boundary, trade log, analytics, copy tracking, export and delete, encryption at rest, expiry, revoke, key-to-trader binding, Intents order building, NEP-413 sign and verify, sign-in replay and forgery rejection, the on-chain gate.
- 6 Rust unit tests on the contract (`npm run test:contract`), and the contract compiles to wasm.
- The dry-run UI flow across all seven tabs (39 checks), by running the real `public/app.js` in jsdom against a live server (`test-ui/`, optional, needs `npm install` there).
- `npm run smoke` against a running server.
- The landing page and app in real headless Chromium at desktop and phone width (`test-browser/`, optional): no console errors, no sideways scroll, key toggle, scroll-driven diagram, countdown ring, FAQ, reduced motion. I also reviewed screenshots of each screen.

Not verified, because the sandbox could not reach the NEAR network or run a browser:
- Testnet mode against the real NEAR RPC. The tests use a local stub that answers the same JSON-RPC requests, so request shapes are checked against my reading of the protocol, not against a live node.
- The contract deployed on a live network, and `buy_key` moving real testnet funds.
- The wallet-selector code in `public/wallet.js` in a real browser.
- A TEE quote. `/api/attestation` returns a real quote only on a dstack host and otherwise says plainly that no TEE is present.
- Submitting the generated orders to the Intents 1Click API.

Expect to fix small things on the first live run. The most likely places are wallet-selector method signatures and CLI flags.

## How the boundary works

- Trades are sealed with AES-256-GCM before they touch disk, with a per-trader key derived from `data/master.key`.
- Public endpoints return only aggregates computed from those trades. The test `public payload never leaks private fields` checks for pair, side, entry, exit, thesis and note.
- A viewing key unlocks exactly one trader and cannot sign or move funds. In testnet mode it is a contract grant tied to the holder's account, and the server asks the contract on every private request, so a revoke takes effect immediately.
- Sign-in uses NEP-413: a single-use server nonce, a signature check, and an RPC check that the signing key belongs to the claimed account.

## TEE attestation

`docker-compose.tee.yml` runs the server on a dstack host such as a Phala Cloud CVM, mounting the guest agent socket. With it, `/api/attestation` returns a TDX quote whose report data binds the master-key fingerprint and the contract account. The header badge reads "TEE attested" only when a quote was produced. This is untested here. What it would prove is limited: that this code image runs in a TEE and holds the key that encrypts trades. It does not prove the trader's trades were executed confidentially.

## Known limits

- Trades are entered by the trader. They are not executed through Confidential Intents, and nothing in the app proves execution. Copy orders are built, not submitted.
- Without a TEE, the server operator can read all trades. That is the main gap against a full "private AI" claim.
- Public curve timestamps reveal when trades closed.
- Only NEAR/USDC is wired. Check asset ids in `src/intents.js` against the live Intents token list.
- Short-trade close legs are sized from entry notional.
- On-chain grants cannot be listed from the contract, so the testnet dashboard revokes by holder account instead of showing a table.
- The server stores state in a local JSON file. Fine for a demo, not for production.

## Layout

```
src/server.js       API and static hosting, both modes
src/metrics.js      public metric math
src/vault.js        encryption and token hashing
src/ledger.js       dry-run ledger
src/chain.js        NEAR RPC client and on-chain ledger
src/nep413.js       NEP-413 verify and sign, base58
src/attestation.js  dstack TEE quote
src/intents.js      Intents quote request builder
public/             index.html (product page), app.html + app.js (app), theme.css, fonts, no build step
test/               Node tests
test-ui/            optional jsdom UI test
test-browser/       optional real-browser test
scripts/            smoke.js, near-login.js
contract/           Rust access contract and unit tests
```
