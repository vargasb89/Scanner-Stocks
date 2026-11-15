export const DEFAULTS = Object.freeze({
  retentionMode: "low", retentionMinimumPct: 50, rvolThreshold: 3,
  volumeLookback: 20, volumeMethod: "median", rvolProvisional: true,
  impulseMinPct: 20, impulseMaxPct: 100, maxOpeningGapPct: 100, preferredFloatMax: 40_000_000,
});

const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const atLeast = (value, minimum) => value >= minimum - 1e-9;
const check = (id, value, threshold, test, advisory = false) => ({
  id, status: value === null ? "missing" : test(value) ? "pass" : "fail", value, threshold, advisory,
});
const manual = (value) => value === "yes" ? true : value === "no" ? false : null;

export function evaluateShortSqueeze({
  symbol, d1Date, bars = [], reference = {}, confirmations = {}, settings: overrides = {}, data = {},
}) {
  const settings = { ...DEFAULTS, ...overrides };
  const ordered = [...new Map(bars.map((bar) => [bar.date, bar])).values()].sort((a, b) => a.date.localeCompare(b.date));
  const index = ordered.findIndex((bar) => bar.date === d1Date);
  const d1 = index >= 0 ? ordered[index] : null;
  const d2 = d1 && ordered[index + 1] && data.d2SessionVerified !== false ? ordered[index + 1] : null;
  const previousClose = index > 0 && data.previousSessionVerified !== false ? positive(ordered[index - 1].close) : null;
  const d1Close = positive(d1?.close);
  const d1High = positive(d1?.high);
  const d1Open = positive(d1?.open);
  const d1OpenGapPct = d1Open !== null && previousClose !== null ? 100 * (d1Open - previousClose) / previousClose : null;
  const d1Volume = positive(d1?.volume);
  const gain = previousClose !== null && d1Close !== null ? d1Close - previousClose : null;
  const d1ChangePct = gain !== null ? 100 * gain / previousClose : null;
  const base = index > 0 ? ordered.slice(Math.max(0, index - settings.volumeLookback), index).map((bar) => positive(bar.volume)).filter((v) => v !== null) : [];
  const volumeBaseline = base.length === settings.volumeLookback && data.volumeSessionsVerified !== false ? median(base) : null;
  const relativeVolume = d1Volume !== null && volumeBaseline !== null ? d1Volume / volumeBaseline : null;
  const d2Low = positive(d2?.low);
  const d2Close = positive(d2?.close);
  const retention = (price) => gain !== null && gain > 0 && price !== null ? 100 * (price - previousClose) / gain : null;
  const d2LowRetentionPct = retention(d2Low);
  const d2CloseRetentionPct = retention(d2Close);
  const freeFloat = positive(reference.freeFloat);
  const sharesOutstanding = positive(reference.sharesOutstanding);
  const metrics = {
    d1ChangePct, d1OpenGapPct, d1High, d1Close, previousClose, d1Volume, volumeBaseline, relativeVolume,
    volumeSamples: base.length, d2Low, d2Close, d2LowRetentionPct, d2CloseRetentionPct,
    retentionFloor: gain !== null && gain > 0 ? previousClose + gain * settings.retentionMinimumPct / 100 : null,
    freeFloat, sharesOutstanding,
  };
  const checks = [
    check("universe", typeof reference.isUsCommonStock === "boolean" ? reference.isUsCommonStock : null, true, Boolean),
    check("lowFloat", manual(confirmations.lowFloat), true, Boolean),
    check("freeFloat", freeFloat, settings.preferredFloatMax, (v) => v < settings.preferredFloatMax, true),
    check("sharesOutstanding", sharesOutstanding, settings.preferredFloatMax, (v) => v < settings.preferredFloatMax, true),
    check("openingGap", d1OpenGapPct, settings.maxOpeningGapPct, (v) => atLeast(settings.maxOpeningGapPct, v)),
    check("impulse", d1ChangePct, { min: settings.impulseMinPct, max: settings.impulseMaxPct },
      (v) => atLeast(v, settings.impulseMinPct) && atLeast(settings.impulseMaxPct, v)),
    check("relativeVolume", relativeVolume, settings.rvolThreshold, (v) => atLeast(v, settings.rvolThreshold)),
    check("etbD1", manual(confirmations.etbD1), true, Boolean),
    check("catalyst", manual(confirmations.catalyst), true, Boolean),
    check("retention", settings.retentionMode === "close" ? d2CloseRetentionPct : d2LowRetentionPct,
      settings.retentionMinimumPct, (v) => atLeast(v, settings.retentionMinimumPct)),
    check("etbD2", d2 ? manual(confirmations.etbD2) : null, true, Boolean),
  ];
  const gates = checks.filter((c) => !c.advisory);
  const status = gates.some((c) => c.status === "fail") ? "excluded" :
    gates.some((c) => c.status === "missing") || d1High === null ? "pending" : "observation";
  return {
    symbol, d1Date, d2Date: d2?.date ?? null, status, settings, metrics, checks,
    d3: { referencePrice: d1High, observationOnly: true, executionsEnabled: false },
    data,
  };
}
