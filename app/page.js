"use client";

import { Download, RefreshCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";

const numberFormatter = new Intl.NumberFormat("en-US");
const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "-";
  return `$${compactFormatter.format(value)}`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  return compactFormatter.format(value);
}

function toCsv(rows) {
  const headers = [
    "Ticker",
    "% Cambio dia actual",
    "Float",
    "Shares Outstanding",
    "Volume",
    "Dia despues corrida/GAP",
    "Market Cap",
    "% Corrida 5 dias",
    "% Retroceso",
    "Ultimo cierre",
    "Dia corrida/GAP",
  ];

  const body = rows.map((row) => [
    row.ticker,
    row.dayChangePct?.toFixed(2),
    row.freeFloat,
    row.sharesOutstanding,
    row.volume,
    row.dayAfterRun || "",
    row.marketCap,
    row.runPct?.toFixed(2),
    row.retracementPct?.toFixed(2),
    row.lastClose,
    row.runDay,
  ]);

  return [headers, ...body]
    .map((line) =>
      line
        .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}

export default function Home() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    moveThreshold: 50,
    maxMarketCap: 300000000,
    maxRetracement: 50,
    lookbackSessions: 5,
    ticker: "",
  });

  const summary = useMemo(() => {
    const totalVolume = rows.reduce((sum, row) => sum + (row.volume || 0), 0);
    const biggestRun = rows.reduce((max, row) => Math.max(max, row.runPct || 0), 0);

    return {
      totalVolume,
      biggestRun,
      avgMarketCap:
        rows.length > 0
          ? rows.reduce((sum, row) => sum + (row.marketCap || 0), 0) / rows.length
          : 0,
    };
  }, [rows]);

  async function runScan() {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      moveThreshold: filters.moveThreshold,
      maxMarketCap: filters.maxMarketCap,
      maxRetracement: filters.maxRetracement,
      lookbackSessions: filters.lookbackSessions,
    });

    if (filters.ticker.trim()) params.set("ticker", filters.ticker.trim());

    try {
      const response = await fetch(`/api/scan?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "No se pudo correr el scanner.");
      }

      setRows(data.results || []);
      setMeta(data.meta || null);
    } catch (scanError) {
      setError(scanError.message);
      setRows([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `massive-scanner-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Massive API</p>
          <h1>Small-Cap Gap Scanner</h1>
        </div>
        <button className="primary" onClick={runScan} disabled={loading}>
          <RefreshCcw size={18} />
          {loading ? "Corriendo" : "Correr scanner"}
        </button>
      </section>

      <section className="controls" aria-label="Filtros">
        <label>
          <span>% corrida</span>
          <input
            type="number"
            value={filters.moveThreshold}
            onChange={(event) =>
              setFilters({ ...filters, moveThreshold: event.target.value })
            }
          />
        </label>
        <label>
          <span>Market cap max.</span>
          <input
            type="number"
            value={filters.maxMarketCap}
            onChange={(event) =>
              setFilters({ ...filters, maxMarketCap: event.target.value })
            }
          />
        </label>
        <label>
          <span>Retroceso max.</span>
          <input
            type="number"
            value={filters.maxRetracement}
            onChange={(event) =>
              setFilters({ ...filters, maxRetracement: event.target.value })
            }
          />
        </label>
        <label>
          <span>Dias trading</span>
          <input
            type="number"
            value={filters.lookbackSessions}
            min="2"
            max="10"
            onChange={(event) =>
              setFilters({ ...filters, lookbackSessions: event.target.value })
            }
          />
        </label>
        <label className="tickerBox">
          <span>Ticker</span>
          <div>
            <Search size={16} />
            <input
              type="text"
              placeholder="Todos"
              value={filters.ticker}
              onChange={(event) =>
                setFilters({ ...filters, ticker: event.target.value.toUpperCase() })
              }
            />
          </div>
        </label>
      </section>

      {error ? <div className="notice error">{error}</div> : null}

      <section className="stats">
        <div>
          <span>Resultados</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Mayor corrida</span>
          <strong>{formatPercent(summary.biggestRun)}</strong>
        </div>
        <div>
          <span>Volumen total</span>
          <strong>{formatNumber(summary.totalVolume)}</strong>
        </div>
        <div>
          <span>Market cap prom.</span>
          <strong>{formatMoney(summary.avgMarketCap)}</strong>
        </div>
      </section>

      <section className="tablePanel">
        <div className="tableTools">
          <div>
            <SlidersHorizontal size={18} />
            <span>
              {meta
                ? `${numberFormatter.format(meta.scannedTickers)} tickers escaneados${meta.scanRunId ? ` · corrida #${meta.scanRunId}` : ""}`
                : "Listo para escanear"}
            </span>
          </div>
          <button className="secondary" onClick={downloadCsv} disabled={!rows.length}>
            <Download size={17} />
            CSV
          </button>
        </div>

        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Ticker</th>
                <th>% Cambio dia actual</th>
                <th>Float</th>
                <th>Shares Outstanding</th>
                <th>Volume</th>
                <th>Dia despues corrida/GAP</th>
                <th>Market Cap</th>
                <th>% Corrida</th>
                <th>% Retroceso</th>
                <th>Ultimo cierre</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ticker}>
                  <td>
                    <strong>{row.ticker}</strong>
                    <small>{row.name}</small>
                  </td>
                  <td className={row.dayChangePct >= 0 ? "positive" : "negative"}>
                    {formatPercent(row.dayChangePct)}
                  </td>
                  <td>{formatNumber(row.freeFloat)}</td>
                  <td>{formatNumber(row.sharesOutstanding)}</td>
                  <td>{formatNumber(row.volume)}</td>
                  <td>{row.dayAfterRun || "-"}</td>
                  <td>{formatMoney(row.marketCap)}</td>
                  <td className="positive">{formatPercent(row.runPct)}</td>
                  <td>{formatPercent(row.retracementPct)}</td>
                  <td>${Number(row.lastClose || 0).toFixed(2)}</td>
                </tr>
              ))}
              {!rows.length && !loading ? (
                <tr>
                  <td colSpan="10" className="empty">
                    Corre el scanner para ver acciones que hayan subido mas de
                    50%, con market cap menor a 300M y retroceso menor al 50%.
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan="10" className="empty">
                    Buscando gaps y corridas recientes...
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer>
        {meta?.databaseWarning
          ? `Scanner listo, pero Neon no guardo la corrida: ${meta.databaseWarning}`
          : meta?.loadedDates?.length
          ? `Datos diarios usados: ${meta.loadedDates.join(", ")}`
          : "La clave se lee solo en el servidor desde MASSIVE_API_KEY."}
      </footer>
    </main>
  );
}
