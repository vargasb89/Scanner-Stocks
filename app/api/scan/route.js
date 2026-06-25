import {
  fetchGroupedDay,
  fetchTickerDetails,
  fetchTickerDailyRange,
  fetchTickerFloat,
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
  lookbackSessions: 5,
  moveThreshold: 50,
  maxMarketCap: 300_000_000,
  maxRetracement: 50,
  calendarDays: 14,
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

    if (sorted.length < settings.lookbackSessions + 1) continue;

    const latest = sorted.at(-1);
    const previous = sorted.at(-2);
    const windowBars = sorted.slice(-settings.lookbackSessions);
    const baseBar = sorted.at(-settings.lookbackSessions - 1);

    if (!latest || !previous || !baseBar) continue;

    const runHighBar = windowBars.reduce((best, bar) =>
      bar.high > best.high ? bar : best,
    );
    const runPct = ((runHighBar.high - baseBar.close) / baseBar.close) * 100;

    if (runPct < settings.moveThreshold) continue;

    const advance = runHighBar.high - baseBar.close;
    if (advance <= 0) continue;

    const retracementPct = ((runHighBar.high - latest.close) / advance) * 100;
    if (retracementPct > settings.maxRetracement) continue;

    const dayChangePct = ((latest.close - previous.close) / previous.close) * 100;
    const runIndex = sorted.findIndex((bar) => bar.date === runHighBar.date);
    const dayAfterRun = sorted[runIndex + 1]?.date || null;

    candidates.push({
      ticker,
      dayChangePct,
      runPct,
      retracementPct: Math.max(0, retracementPct),
      volume: latest.volume,
      lastClose: latest.close,
      runHigh: runHighBar.high,
      runDay: runHighBar.date,
      dayAfterRun,
      baseDate: baseBar.date,
      baseClose: baseBar.close,
      latestDate: latest.date,
    });
  }

  return candidates.sort((a, b) => b.runPct - a.runPct);
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

async function enrichCandidate(candidate) {
  const cached = await getCachedFundamentals(candidate.ticker);
  if (cached) {
    return {
      ...candidate,
      ...cached,
    };
  }

  const details = await fetchTickerDetails(candidate.ticker);

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
    const dates = getRecentCalendarDates(settings.calendarDays);
    const dailyResults = [];
    const dataSources = { api: 0, cache: 0 };

    if (tickerFilter) {
      const range = dateRangeFromCalendarDates(dates);
      dailyResults.push(await fetchTickerDailyRange(tickerFilter, range.from, range.to));
      dataSources.api = 1;
    } else {
      for (const date of dates) {
        const day = await getGroupedDayWithCache(date);
        dailyResults.push(day.bars);
        dataSources[day.source] += 1;

        if (day.source === "api") {
          await sleep(12500);
        }
      }
    }

    const barsByTicker = new Map();
    const loadedDates = [];

    for (const [dayIndex, bars] of dailyResults.entries()) {
      if (bars.length > 0) loadedDates.push(dates[dayIndex]);

      for (const bar of bars) {
        if (tickerFilter && bar.ticker !== tickerFilter) continue;
        if (!barsByTicker.has(bar.ticker)) barsByTicker.set(bar.ticker, []);
        barsByTicker.get(bar.ticker).push(bar);
      }
    }

    const priceCandidates = buildPriceCandidates(barsByTicker, settings);
    const withDetails = await enrichWithConcurrency(priceCandidates.slice(0, 120));
    const marketCapMatches = withDetails
      .filter((row) => row.marketCap !== null && row.marketCap < settings.maxMarketCap)
      .sort((a, b) => b.runPct - a.runPct);
    const results = [];

    for (const row of marketCapMatches) {
      if (row.freeFloat !== undefined && row.freeFloat !== null) {
        results.push(row);
        continue;
      }

      const floatData = await fetchTickerFloat(row.ticker);
      const enriched = { ...row, ...floatData };
      await saveFundamentals(row.ticker, enriched);
      results.push(enriched);
      await sleep(12500);
    }

    const meta = {
      scannedTickers: barsByTicker.size,
      priceCandidates: priceCandidates.length,
      loadedDates: loadedDates.sort(),
      dataSources,
      settings,
      generatedAt: new Date().toISOString(),
    };

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
