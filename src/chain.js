// NEAR JSON-RPC client and the on-chain ledger. No dependencies.
export const DEFAULT_RPCS = {
  testnet: ['https://rpc.testnet.near.org', 'https://rpc.testnet.fastnear.com', 'https://near-testnet.lava.build'],
  mainnet: ['https://rpc.mainnet.near.org', 'https://rpc.mainnet.fastnear.com', 'https://near.lava.build'],
};

// urls: one endpoint or a list. Every call tries each endpoint in turn, so a dead or rate-limited
// one is skipped. Contract errors (a panic in a view) are real answers and are not retried.
export function createRpc(urls) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  async function once(url, method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'keyview', method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  async function call(method, params) {
    const errors = [];
    for (let round = 0; round < 3; round++) {
      for (const url of list) {
        try { return await once(url, method, params); }
        catch (e) { errors.push(`${new URL(url).host}: ${e.message}`); }
      }
      await new Promise((r) => setTimeout(r, 250 * (round + 1)));
    }
    throw new Error(`No NEAR RPC answered (${[...new Set(errors)].join('; ')})`);
  }
  return {
    url: list[0],
    urls: list,
    // For /api/health?deep=1: which endpoints answer from this server right now.
    async probe() {
      return Promise.all(list.map(async (url) => {
        const t0 = Date.now();
        try {
          const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'p', method: 'status', params: [] }), signal: AbortSignal.timeout(6000) });
          if (!res.ok) return { url, ok: false, ms: Date.now() - t0, error: `HTTP ${res.status}` };
          const j = await res.json();
          return { url, ok: !!j.result, ms: Date.now() - t0, chain: j.result?.chain_id || null, error: j.result ? null : 'no status result' };
        } catch (e) { return { url, ok: false, ms: Date.now() - t0, error: e.message }; }
      }));
    },
    async view(contract, method, args) {
      const body = await call('query', {
        request_type: 'call_function', finality: 'final', account_id: contract,
        method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      });
      if (body.error || body.result?.error) throw new Error(`View ${method} failed: ${JSON.stringify(body.error || body.result.error)}`);
      const text = Buffer.from(body.result.result).toString('utf8');
      return text ? JSON.parse(text) : null;
    },
    async accessKeyExists(account, publicKey) {
      const body = await call('query', { request_type: 'view_access_key', finality: 'final', account_id: account, public_key: publicKey });
      if (body.error || body.result?.error) return false;
      return body.result && body.result.permission !== undefined;
    },
  };
}

export function yoctoToNear(yocto) {
  const y = BigInt(yocto);
  const whole = y / 10n ** 24n;
  const frac = (y % 10n ** 24n).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function createChainLedger({ contract, rpcUrl, network = 'testnet' }) {
  const rpc = createRpc(rpcUrl || DEFAULT_RPCS[network]);
  const offerCache = new Map();
  return {
    mode: 'testnet',
    network, contract, rpc,
    hasAccess: (trader, holder) => rpc.view(contract, 'has_access', { trader, holder }),
    getGrant: (trader, holder) => rpc.view(contract, 'get_grant', { trader, holder }),
    async getOffers(trader) {
      const hit = offerCache.get(trader);
      if (hit && Date.now() - hit.at < 20_000) return hit.offers;
      try {
        const out = [];
        for (const durationDays of [7, 30]) {
          const p = await rpc.view(contract, 'get_offer', { trader, duration_days: durationDays });
          if (p) out.push({ durationDays, priceNear: Number(yoctoToNear(p)), priceYocto: p });
        }
        offerCache.set(trader, { at: Date.now(), offers: out });
        return out;
      } catch (e) {
        // Serve the last good answer for up to 10 minutes rather than pretending there are no offers.
        if (hit && Date.now() - hit.at < 600_000) return hit.offers;
        throw e;
      }
    },
  };
}
