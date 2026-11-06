// Public metrics. These are the ONLY values derived from private trades
// that leave the confidential boundary.
export function tradePnlPct(t) {
  const raw = t.side === 'long'
    ? (t.exit - t.entry) / t.entry
    : (t.entry - t.exit) / t.entry;
  // Weighted by the share of the strategy portfolio used in the trade.
  return raw * 100 * (t.sizePct / 100);
}

export function computeMetrics(trades) {
  const pnls = trades.map(tradePnlPct);
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const curve = [];
  pnls.forEach((p, i) => {
    cum += p;
    peak = Math.max(peak, cum);
    maxDrawdown = Math.max(maxDrawdown, peak - cum);
    curve.push({ n: i + 1, cumPnlPct: round(cum), at: trades[i].closedAt });
  });
  const wins = pnls.filter((p) => p > 0).length;
  return {
    totalPnlPct: round(cum),
    trades: trades.length,
    winRatePct: trades.length ? round((wins / trades.length) * 100) : null,
    maxDrawdownPct: trades.length ? round(maxDrawdown) : null,
    curve,
  };
}

function round(x) { return Math.round(x * 100) / 100; }
