// NEAR JSON-RPC client and the on-chain ledger. No dependencies.
export function createRpc(url) {
  // Public RPCs rate-limit and hiccup. Retry network errors, 429 and 5xx a few times with a short backoff.
  async function call(method, params) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'keyview', method, params }),
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`RPC HTTP ${res.status}`);
        if (!res.ok) throw Object.assign(new Error(`RPC HTTP ${res.status}`), { final: true });
        return await res.json();
      } catch (e) {
        last = e;
        if (e.final) break;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1) ** 2));
      }
    }
    throw last;
  }
  return {
    url,
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
  const rpc = createRpc(rpcUrl);
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
