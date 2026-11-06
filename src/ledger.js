// Access ledger. The server only talks to this interface, so the dry-run
// ledger (local) and a NEAR testnet ledger are interchangeable.
//
//   recordPurchase({ keyId, trader, buyer, expiresAt, priceNear }) -> { ref }
//   recordRevoke({ keyId, trader }) -> { ref }
//
// The dry-run ledger is the default. A testnet ledger backed by contract/
// implements the same two calls (see README, "Testnet mode").
export function createDryRunLedger() {
  return {
    mode: 'dry-run',
    async recordPurchase({ keyId }) { return { ref: `dryrun:purchase:${keyId}` }; },
    async recordRevoke({ keyId }) { return { ref: `dryrun:revoke:${keyId}` }; },
  };
}
