import {
  fetchGroupedDay,
  fetchTickerDetails,
  fetchTickerDailyRange,
  getRecentCalendarDates,
} from "@/lib/massive";
import {
  getCachedFundamentals,
  getCachedGroupedDay,
  saveFundamentals,
  saveGroupedDay,
  saveScanRun,
} from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULTS = {
  lookbackSessions: 6,
  moveThreshold: 50,
  maxMarketCap: 300_000_000,
  maxRetracement: 50,
  calendarDays: 21,
};

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatTicker(ticker) {
  return String(ticker || "").trim().toUpperCase();
}

function buildPriceCandidates(barsByTicker, settings) {
  const candidates = [];

  for (const [ticker, bars] of barsByTicker.entries()) {
    const sorted = bars
      .filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length < settings.lookbackSessions) continue;

    const recentBars = sorted.slice(-settings.lookbackSessions);
    const latest = sorted.at(-1);
    const previous = sorted.at(-2);

    if (!latest || !previous) continue;

    const runs = [];

    for (let index = 1; index < recentBars.length; index += 1) {
      const bar = recentBars[index];
      const priorBar = recentBars[index - 1];
      const prevClose = priorBar.close;
      const advance = bar.high - prevClose;

      if (advance <= 0) continue;

      const runPct = ((bar.high / prevClose) - 1) * 100;
      const retracementPct = ((bar.high - bar.close) / advance) * 100;
      const isRun =
        runPct >= settings.moveThreshold &&
        retracementPct <= settings.maxRetracement &&
        bar.close > bar.open;

      if (isRun) {
        runs.push({
          bar,
          prevClose,
          runPct,
          retracementPct: Math.max(0, retracementPct),
          midpoint: prevClose + advance * 0.5,
        });
      }
    }

    const latestRun = runs.at(-1);
    if (!latestRun) continue;

    const runIndex = sorted.findIndex((bar) => bar.date === latestRun.bar.date);
    const dayAfterRun = sorted[runIndex + 1]?.date || null;
    const dayChangePct = ((latest.close - previous.close) / previous.close) * 100;
    let daysHolding = 0;

    for (const bar of sorted.slice(runIndex)) {
      if (bar.close >= latestRun.midpoint) {
        daysHolding += 1;
      } else {
        break;
      }
    }

    candidates.push({
      ticker,
      dayChangePct,
      runPct: latestRun.runPct,
      retracementPct: latestRun.retracementPct,
      volume: latest.volume,
      runDayVolume: latestRun.bar.volume,
      lastClose: latest.close,
      runHigh: latestRun.bar.high,
      runDay: latestRun.bar.date,
      dayAfterRun,
      daysHolding,
      midpoint: latestRun.midpoint,
      baseDate: recentBars[0].date,
      baseClose: latestRun.prevClose,
      latestDate: latest.date,
    });
  }

  return candidates.sort((a, b) => b.runPct - a.runPct);
}

function buildMetaWarnings({ errorCount, loadedDates, settings }) {
  const warnings = [];
  const requiredSessions = settings.lookbackSessions;

  if (errorCount > 0) {
    warnings.push(
      `Massive limito algunas llamadas; se usaron los datos disponibles en cache.`,
    );
  }

  if (loadedDates.length < requiredSessions) {
    warnings.push(
      `Hay ${loadedDates.length} sesiones cargadas y se necesitan al menos ${requiredSessions} para calcular ${settings.lookbackSessions} dias.`,
    );
  }

  return warnings;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateRangeFromCalendarDates(dates) {
  const sorted = [...dates].sort();
  return {
    from: sorted[0],
    to: sorted.at(-1),
  };
}

async function getGroupedDayWithCache(date) {
  const cached = await getCachedGroupedDay(date);
  if (cached) return { bars: cached, source: "cache" };

  const bars = await fetchGroupedDay(date);
  await saveGroupedDay(date, bars);
  return { bars, source: "api" };
}

function normalizeMarketCap(row) {
  const estimatedMarketCap =
    row.sharesOutstanding && row.lastClose
      ? row.sharesOutstanding * row.lastClose
      : null;
  const marketCap = row.marketCap ?? estimatedMarketCap;

  return {
    ...row,
    marketCap,
    marketCapSource: row.marketCap ? "reported" : estimatedMarketCap ? "estimated" : "missing",
  };
}

async function enrichCandidate(candidate) {
  const cached = await getCachedFundamentals(candidate.ticker);
  if (cached) {
    return {
      ...candidate,
      ...cached,
    };
  }

  let details = {};

  try {
    details = await fetchTickerDetails(candidate.ticker);
  } catch {
    details = {};
  }

  const enriched = {
    ...candidate,
    name: details.name || "",
    marketCap: details.market_cap ?? null,
    sharesOutstanding:
      details.weighted_shares_outstanding ??
      details.share_class_shares_outstanding ??
      null,
    shareClassSharesOutstanding: details.share_class_shares_outstanding ?? null,
    weightedSharesOutstanding: details.weighted_shares_outstanding ?? null,
    primaryExchange: details.primary_exchange || "",
    type: details.type || "",
  };

  await saveFundamentals(candidate.ticker, enriched);
  return enriched;
}

async function enrichWithConcurrency(candidates, concurrency = 2) {
  const enriched = [];
  let index = 0;

  async function worker() {
    while (index < candidates.length) {
      const current = candidates[index];
      index += 1;
      enriched.push(await enrichCandidate(current));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return enriched;
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const settings = {
      lookbackSessions: Math.max(
        2,
        Math.min(
          10,
          toNumber(url.searchParams.get("lookbackSessions"), DEFAULTS.lookbackSessions),
        ),
      ),
      moveThreshold: toNumber(url.searchParams.get("moveThreshold"), DEFAULTS.moveThreshold),
      maxMarketCap: toNumber(url.searchParams.get("maxMarketCap"), DEFAULTS.maxMarketCap),
      maxRetracement: toNumber(url.searchParams.get("maxRetracement"), DEFAULTS.maxRetracement),
      calendarDays: Math.max(
        8,
        Math.min(30, toNumber(url.searchParams.get("calendarDays"), DEFAULTS.calendarDays)),
      ),
    };

    const tickerFilter = formatTicker(url.searchParams.get("ticker"));
    const scanCalendarDays = Math.max(settings.calendarDays, settings.lookbackSessions * 4);
    const dates = getRecentCalendarDates(scanCalendarDays);
    const dailyResults = [];
    const dataSources = { api: 0, cache: 0 };
    const loadErrors = [];
    const loadedMarketDates = [];

    if (tickerFilter) {
      const range = dateRangeFromCalendarDates(dates);
      dailyResults.push(await fetchTickerDailyRange(tickerFilter, range.from, range.to));
      dataSources.api = 1;
    } else {
      for (const date of dates) {
        try {
          const day = await getGroupedDayWithCache(date);
          dailyResults.push(day.bars);
          dataSources[day.source] += 1;
          if (day.bars.length > 0) loadedMarketDates.push(date);

          if (day.source === "api") {
            await sleep(12500);
          }
        } catch (loadError) {
          loadErrors.push({ date, message: loadError.message });
          dailyResults.push([]);
        }

        if (loadedMarketDates.length >= settings.lookbackSessions) {
          break;
        }
      }
    }

    const barsByTicker = new Map();
    const loadedDatesSet = new Set();

    for (const [dayIndex, bars] of dailyResults.entries()) {
      if (bars.length > 0 && !tickerFilter) loadedDatesSet.add(dates[dayIndex]);

      for (const bar of bars) {
        if (tickerFilter && bar.ticker !== tickerFilter) continue;
        loadedDatesSet.add(bar.date);
        if (!barsByTicker.has(bar.ticker)) barsByTicker.set(bar.ticker, []);
        barsByTicker.get(bar.ticker).push(bar);
      }
    }

    const priceCandidates = buildPriceCandidates(barsByTicker, settings);
    const withDetails = await enrichWithConcurrency(priceCandidates.slice(0, 120));
    const rowsWithMarketCap = withDetails.map(normalizeMarketCap);
    const marketCapMatches = rowsWithMarketCap
      .filter((row) => row.marketCap === null || row.marketCap < settings.maxMarketCap)
      .sort((a, b) => b.runPct - a.runPct);
    const results = [];

    for (const row of marketCapMatches) {
      results.push(row);
    }

    const meta = {
      scannedTickers: barsByTicker.size,
      priceCandidates: priceCandidates.length,
      loadedDates: [...loadedDatesSet].sort(),
      dataSources,
      loadErrors: loadErrors.slice(0, 5),
      settings,
      generatedAt: new Date().toISOString(),
    };

    meta.warnings = buildMetaWarnings({
      errorCount: loadErrors.length,
      loadedDates: meta.loadedDates,
      settings,
    });

    try {
      meta.scanRunId = await saveScanRun({ settings, meta, results });
    } catch (dbError) {
      meta.databaseWarning = dbError.message;
    }

    return Response.json({
      results,
      meta,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
