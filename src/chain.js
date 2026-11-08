// NEAR JSON-RPC client and the on-chain ledger. No dependencies.
export function createRpc(url) {
  async function call(method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'keyview', method, params }),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    return res.json();
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
  return {
    mode: 'testnet',
    network, contract, rpc,
    hasAccess: (trader, holder) => rpc.view(contract, 'has_access', { trader, holder }),
    getGrant: (trader, holder) => rpc.view(contract, 'get_grant', { trader, holder }),
    async getOffers(trader) {
      const out = [];
      for (const durationDays of [7, 30]) {
        const p = await rpc.view(contract, 'get_offer', { trader, duration_days: durationDays });
        if (p) out.push({ durationDays, priceNear: Number(yoctoToNear(p)), priceYocto: p });
      }
      return out;
    },
  };
}
