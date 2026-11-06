// Builds NEAR Intents (1Click swap API shaped) quote requests that a
// follower would submit to mirror a trade. Nothing is sent from here.
// Check asset ids against the live token list before any mainnet use.
export const ASSETS = {
  NEAR: { id: 'nep141:wrap.near', decimals: 24 },
  USDC: {
    id: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    decimals: 6,
  },
};
export const PAIRS = ['NEAR/USDC'];

function toBase(amount, decimals) {
  const [w, f = ''] = String(amount).split('.');
  return (BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals))).toString();
}

export function buildLegs(trade, followerAccount, usdBudget) {
  const [base, quote] = trade.pair.split('/');
  const usd = usdBudget * (trade.sizePct / 100);
  const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const common = {
    dry: true,
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    depositType: 'ORIGIN_CHAIN',
    refundType: 'ORIGIN_CHAIN',
    recipientType: 'DESTINATION_CHAIN',
    refundTo: followerAccount,
    recipient: followerAccount,
    deadline,
  };
  const baseUnits = usd / trade.entry;
  const q = ASSETS[quote];
  const b = ASSETS[base];
  const buyBase = { originAsset: q.id, destinationAsset: b.id, amount: toBase(usd.toFixed(q.decimals), q.decimals) };
  const sellBase = { originAsset: b.id, destinationAsset: q.id, amount: toBase(baseUnits.toFixed(8), b.decimals) };
  const long = trade.side === 'long';
  return [
    { leg: 'open', ...common, ...(long ? buyBase : sellBase) },
    { leg: 'close', ...common, ...(long ? sellBase : buyBase) },
  ];
}
