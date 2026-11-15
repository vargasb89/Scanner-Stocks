// First-pass, price-only discovery. Detailed eligibility is evaluated separately.
export function rankShortSqueezeUniverse({ previousBars, d1Bars, d2Bars, limit = 35 }) {
  const positive = (value) => Number.isFinite(value) && value > 0;
  const prev = new Map(previousBars.map((bar) => [bar.ticker, bar]));
  const next = d2Bars ? new Map(d2Bars.map((bar) => [bar.ticker, bar])) : null;
  const rows = [];
  let failedRetention = 0;

  for (const bar of d1Bars) {
    const base = prev.get(bar.ticker)?.close;
    if (!bar.ticker || !positive(base) || !positive(bar.close) || !positive(bar.high)) continue;
    if (positive(bar.open) && 100 * (bar.open - base) / base > 100 + 1e-8) continue;
    const gain = bar.close - base;
    const changePct = 100 * gain / base;
    if (changePct < 20 - 1e-8 || changePct > 100 + 1e-8) continue;
    const d2 = next?.get(bar.ticker);
    const d2RetentionPct = positive(d2?.low) ? 100 * (d2.low - base) / gain : null;
    if (d2RetentionPct !== null && d2RetentionPct < 50 - 1e-8) {
      failedRetention += 1;
      continue;
    }
    rows.push({
      symbol: bar.ticker,
      changePct,
      volume: Number.isFinite(bar.volume) ? bar.volume : null,
      high: bar.high,
      close: bar.close,
      d2RetentionPct,
    });
  }

  rows.sort((a, b) =>
    Number(b.d2RetentionPct !== null) - Number(a.d2RetentionPct !== null)
    || (b.volume ?? 0) - (a.volume ?? 0)
    || b.changePct - a.changePct
    || a.symbol.localeCompare(b.symbol));
  return { rows: rows.slice(0, limit), total: rows.length, failedRetention };
}
