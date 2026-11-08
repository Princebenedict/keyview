// Browser wallet layer for testnet mode. Loaded only when the server reports
// mode "testnet", so dry-run never touches a CDN.
// Wallets with in-page or popup message signing: Meteor and HERE.
const V = '10.1.4';
let selectorPromise = null;

export const NEAR = 10n ** 24n;
export function nearToYocto(text) {
  const m = String(text).trim().match(/^(\d+)(?:\.(\d{1,24}))?$/);
  if (!m) throw new Error('Enter a price like 2 or 0.5');
  return (BigInt(m[1]) * NEAR + BigInt((m[2] || '').padEnd(24, '0'))).toString();
}

async function selector(cfg) {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const [{ setupWalletSelector }, { setupMeteorWallet }, { setupHereWallet }, { Buffer }] = await Promise.all([
        import(`https://esm.sh/@near-wallet-selector/core@${V}`),
        import(`https://esm.sh/@near-wallet-selector/meteor-wallet@${V}`),
        import(`https://esm.sh/@near-wallet-selector/here-wallet@${V}`),
        import('https://esm.sh/buffer@6.0.3'),
      ]);
      window.Buffer = window.Buffer || Buffer;
      return setupWalletSelector({ network: cfg.network, modules: [setupMeteorWallet(), setupHereWallet()] });
    })();
  }
  return selectorPromise;
}

export const WALLETS = [{ id: 'meteor-wallet', label: 'Meteor Wallet' }, { id: 'here-wallet', label: 'HERE Wallet' }];

// Connects a wallet, signs the server's NEP-413 challenge, and returns the signed payload.
export async function connectAndSign(cfg, walletId, challenge) {
  const sel = await selector(cfg);
  const wallet = await sel.wallet(walletId);
  const accounts = await wallet.signIn({ contractId: cfg.contract, accounts: [] });
  const accountId = accounts[0].accountId;
  const signed = await wallet.signMessage({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: window.Buffer.from(challenge.nonce, 'base64'),
  });
  return { accountId: signed.accountId || accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce, walletId };
}

// Calls a method on the KeyView contract through the connected wallet.
export async function callContract(cfg, walletId, methodName, args, depositYocto = '0') {
  const sel = await selector(cfg);
  const wallet = await sel.wallet(walletId);
  return wallet.signAndSendTransaction({
    receiverId: cfg.contract,
    actions: [{ type: 'FunctionCall', params: { methodName, args, gas: '60000000000000', deposit: depositYocto } }],
  });
}
