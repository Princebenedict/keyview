# KeyView

Confidential social trading on NEAR. Traders keep their strategy private and sell time-limited viewing keys. Anyone can see public PnL and risk. Only key holders can see the trades and thesis, and copy them through NEAR Intents.

Live demo: https://keyview-be1v.onrender.com

Live demo (real NEAR testnet): https://keyview-testnet.onrender.com/app

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

Neo-Brutalist "Acid": a paper background (`#F8F4E8`), ink-black borders and type (`#09090B`), and one acid accent (`#D2E823`). Headings and every uppercase string are Dela Gothic One, body text is Space Grotesk, small labels are Space Mono. All tokens live in `public/theme.css`.

The rules, and how they are kept:
- 2px ink borders on every button, link and card. Shadows are solid offset blocks, never blurred.
- No large box has a corner radius above 32px. Pills and circles are the only fully round shapes.
- Buttons press: they move 2px and lose their shadow on hover, and drop 4px when clicked.
- Display text glitches on hover (five moves in 0.3s). The marquee loops in 20s. Accent cards float 10px up and down. A 3% SVG noise sits over the whole page.
- A 32px white cursor with `mix-blend-mode: difference` follows the mouse with a 0.2 lerp and grows 2.5x over links and buttons. It is off on touch screens.
- Dark mode (Settings) keeps the same rules with acid shadows on an ink page.

`/` is the product page: a 12-column hero, a keyhole card that reveals the private fields under your cursor, a horizontal rail of step cards with arrow buttons, a bento grid, and a full-width ink footer. `/app` is the app in the same system. The mascot, The Keykeeper, is three flat SVGs in `public/mascot/`, rebuilt with `python3 scripts/gen-mascot.py`.

Motion respects `prefers-reduced-motion`. The fonts are bundled in `public/fonts` under the SIL Open Font License, so the design renders offline. There is no build step and no framework.

## Run it (dry-run)

No dependencies to install.

1. `npm start`
2. Open http://localhost:3000. You land on the product page. Click Launch app to open the app at http://localhost:3000/app.
3. `npm test` (21 tests)
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

These commands were run end to end on NEAR testnet. `near-cli-rs` and `cargo-near` change syntax between releases, so check `--help` if one is rejected. Use `.testnet` names: the faucet refuses anything else.

1. Create three testnet accounts (contract, trader, buyer), one command each:

```
near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair --signature-scheme ed25519 save-to-legacy-keychain network-config testnet create
```

2. Build and deploy the contract, calling `new`:

```
cd contract
cargo near build non-reproducible-wasm
near contract deploy <contract>.testnet use-file target/near/keyview_access.wasm with-init-call new json-args '{}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

3. The trader puts a 7 day key on sale for 0.1 NEAR, and the buyer buys it:

```
near contract call-function as-transaction <contract>.testnet set_offer json-args '{"duration_days":7,"price_yocto":"100000000000000000000000"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as <trader>.testnet network-config testnet sign-with-legacy-keychain send
near contract call-function as-transaction <contract>.testnet buy_key json-args '{"trader":"<trader>.testnet","duration_days":7}' prepaid-gas '50.0 Tgas' attached-deposit '0.1 NEAR' sign-as <buyer>.testnet network-config testnet sign-with-legacy-keychain send
```

4. Start the server in testnet mode (use another `PORT` if 3000 is taken):

```
KEYVIEW_MODE=testnet KEYVIEW_CONTRACT=<contract>.testnet npm start
```

5. Run the end-to-end check. It signs in as the trader and the buyer with the keys `near` saved, so nothing is pasted:

```
TRADER=<trader>.testnet BUYER=<buyer>.testnet npm run check:testnet
```

See: 11 PASS lines. To test revoke, have the trader call `revoke` with `{"holder":"<buyer>.testnet"}`, run the check again, and see the unlock step fail. Buy again and it passes.

6. In the browser, open the server and use the Trader dashboard with Meteor or HERE wallet (see "What is verified" for the status of this part).

Environment variables: see `.env.example`. `npm run login` signs in with a key from the environment and prints a session token, for scripts.

## What is verified, and what is not

Verified on the live NEAR testnet, in November 2026:
- The access contract is deployed at `benkeyview.testnet`.
- The server in testnet mode talked to the real NEAR RPC. The trader and buyer signed in with NEP-413 messages using their real keys, and the server confirmed those keys belong to the accounts on chain.
- The key offer shown to the public is read from the contract.
- A buyer who paid 0.1 NEAR through `buy_key` unlocked the private view. Before buying, the same account was refused.
- After the trader called `revoke`, the buyer's very next request was refused. After buying again, access returned.
- Copy orders were built for the signed-in buyer's account.

Proof (open in a NEAR testnet explorer):
- Contract deploy and `new`: `A6Q73ZG2EmqeHxfRNdf8SmkAS5dyy1Wzt4tPiJycZpsh`
- Trader `revoke` of the buyer: `AjWLB944fNi2eRq6Rk5Uou8Q7JZrnRBP84yaHk3Eo5Ku`
- Buyer `buy_key` after the revoke: `7jBmbUsDCntNpvB5frxgfzsFvSiUpibKsyUB6R4QSbNT`
- Accounts: contract `benkeyview.testnet`, trader `benkeyview-trader.testnet`, buyer `benkeyview-buyer.testnet`. Link form: `https://explorer.testnet.near.org/transactions/<id>`.

Verified in the authoring sandbox and in CI:
- 21 Node tests: public/private boundary, trade log, analytics, copy tracking, export and delete, encryption at rest, expiry, revoke, key-to-trader binding, Intents order building, NEP-413 sign and verify, sign-in replay and forgery rejection, the on-chain gate against a stub RPC.
- 6 Rust unit tests on the contract (`npm run test:contract`), and the contract compiles to wasm.
- The dry-run UI flow across all seven tabs (39 checks), by running the real `public/app.js` in jsdom against a live server (`test-ui/`, optional, needs `npm install` there).
- `npm run smoke` against a running server, including the public demo.
- The landing page and app in real headless Chromium at desktop and phone width (`test-browser/`, optional): no console errors, no sideways scroll, no blurred shadows, 2px borders on every interactive element, no large radius above 32px, the glitch, the cursor scaling, the keyhole, the step rail, the countdown ring, the FAQ, and reduced motion. I also reviewed screenshots of each screen.

Not verified:
- The wallet-selector code in `public/wallet.js` in a real browser with Meteor or HERE wallet. The chain steps above were done with `near` CLI keys, not through the browser wallet.
- `set_offer`, `buy_key` and `revoke` sent from the browser UI. The same contract calls work from the CLI.
- A TEE quote. `/api/attestation` returns a real quote only on a dstack host and otherwise says plainly that no TEE is present.
- Submitting the generated orders to the Intents 1Click API.
- Mainnet. Nothing here has been deployed to mainnet.

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
public/             index.html + landing.* (product page), app.html + app.* (app), theme.css, cursor.js, mascot/, fonts/, no build step
test/               Node tests
test-ui/            optional jsdom UI test
test-browser/       optional real-browser test
scripts/            smoke.js, near-login.js
contract/           Rust access contract and unit tests
```
