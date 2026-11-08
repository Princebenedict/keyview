# KeyView

Confidential social trading on NEAR. Traders keep their strategy private and sell time-limited viewing keys. Anyone can see public PnL and risk. Only key holders can see the trades and thesis, and copy them through NEAR Intents.

Live demo: https://<your-service>.onrender.com


Track: Privacy and Private AI (secondary: Agent Economy).

## What works today

| Area | Status |
|---|---|
| Public stats (PnL, trades, win rate, max drawdown, equity curve, leaderboard) | Working, no key needed |
| Private gate (thesis and trade details need a valid viewing key) | Working, covered by tests |
| Time-limited keys (7 or 30 days), expiry, early revoke | Working |
| Trade details encrypted at rest (AES-256-GCM, per-trader key) | Working |
| Copy flow producing NEAR Intents quote requests (`dry: true`) | Working, requests are built but not submitted |
| Payment | Simulated in dry-run mode |
| NEAR access contract (NEP-171 style key tokens) | Source in `contract/`, not yet compiled or deployed |
| Wallet sign-in, Confidential Intents execution, TEE attestation | Not built |

Dry-run is the default and needs no funds and no wallet. Trades are entered by the trader. Nothing is seeded, so a fresh install shows empty states until you create data.

## Run it

Requires Node 20 or newer. There are no dependencies to install.

1. `npm start`
2. Open http://localhost:3000
3. `npm test` runs the gate tests (8 tests).
4. With the server running, `npm run smoke` runs the full flow over HTTP.

## Judge walkthrough: do X, see Y

1. Open the app. See: an empty leaderboard and the badge "dry-run mode".
2. Go to Trader dashboard, enter `alice.testnet`, click Create profile. See: the dashboard with all metrics at n/a.
3. Save a strategy with a name, tagline and a private thesis.
4. Record two trades (for example long NEAR/USDC 4.00 to 4.40 at 50%, then short 4.40 to 4.60 at 50%). See: Total PnL +2.73%, win rate 50%, max drawdown -2.27%.
5. Under Sell viewing keys, set a 7 day price and save.
6. Open an incognito window and go to the leaderboard, then click alice.testnet. See: stats and curve, and a locked "Private strategy" panel. No pair, side, price or thesis is shown.
7. In that window enter `bob.testnet`, choose the 7 day key, click Buy. See: the private panel unlocks with thesis and trades.
8. Under Copy this strategy enter a budget and click Build Intents orders. See: open and close legs as 1Click-shaped quote requests.
9. Back in the trader window, Issued keys shows bob's key. Click Revoke.
10. Reload the follower window. See: "Your stored key was rejected: Viewing key is revoked".

For AI judges: `npm test` and `npm run smoke` assert every claim above, including that the public API payloads never contain private fields.

## How the boundary works

- Trades are sealed with AES-256-GCM before they touch disk. The key is derived per trader from a master secret in `data/master.key`.
- Public endpoints compute metrics from the decrypted trades and return only aggregates. The test `public payload never leaks private fields` checks for pair, side, entry, exit, thesis and note.
- A viewing key is a random bearer token. Only its SHA-256 hash is stored, along with trader, holder, expiry and revoked flag. A key unlocks exactly one trader.
- A viewing key cannot sign anything or move funds. It is a read credential, not a wallet key. The manage token (shown once at profile creation) is separate and is rejected as a viewing key.

## Known limits

- The server is trusted with the master secret. A real confidential deployment would run it inside a TEE and attest it. That is the main gap against the "private AI" track.
- Public equity curve timestamps reveal when trades closed. Aggregate only, but not zero information.
- In dry-run mode a profile is controlled by a token in the browser, not a wallet.
- Only the NEAR/USDC pair is wired. Asset ids in `src/intents.js` should be checked against the live Intents token list.
- Short-trade close legs are sized from the entry notional, not the exit price.

## Testnet mode (next step)

`src/ledger.js` defines the two calls the server makes: `recordPurchase` and `recordRevoke`. `contract/` holds an access contract that implements purchase, expiry, revoke and a `has_access` view. To wire it up: build with `cargo near build`, deploy to a testnet account, add a ledger that calls it through `near-api-js`, and replace the dry-run sign-in with NEP-413 message signing.

## Layout

```
src/server.js     API and static hosting
src/metrics.js    public metric math
src/vault.js      encryption and token hashing
src/ledger.js     dry-run ledger interface
src/intents.js    Intents quote request builder
public/           single page UI, no build step
test/             gate tests
scripts/smoke.js  end-to-end HTTP check
contract/         NEAR access contract source
```
