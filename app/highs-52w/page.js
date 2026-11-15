"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import s from "../short-squeeze/squeeze.module.css";

const money = new Intl.NumberFormat("es-CO", {minimumFractionDigits: 2, maximumFractionDigits: 6});
const shares = new Intl.NumberFormat("es-CO", {maximumFractionDigits: 0});
const n = (v, fmt) => Number.isFinite(v) ? fmt.format(v) : "—";
function priorWeekday() {
  const fields = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).map(({type,value})=>[type,value]));
  const d = new Date(`${fields.year}-${fields.month}-${fields.day}T00:00:00Z`);
  do { d.setUTCDate(d.getUTCDate()-1); } while ([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
export default function Highs52Page() {
  const [date,setDate] = useState("");
  const [view,setView] = useState({kind:"idle"});
  const ctrl = useRef(null);
  useEffect(() => { setDate(priorWeekday()); return () => ctrl.current?.abort(); },[]);
  async function search(e) {
    e.preventDefault();
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setView({kind:"loading"});
    try {
      const r = await fetch("/api/highs-52w?" + new URLSearchParams({date}),{signal:c.signal});
      const v = await r.json();
      if (!r.ok) throw new Error(v.error || "La consulta no está disponible.");
      if (!c.signal.aborted) setView({kind:"result",v});
    } catch(err) {
      if (!c.signal.aborted) setView({kind:"error",message:err.message});
    }
  }
  const result = view.v;
  const m = result?.meta;
  return <main className={s.page}><div className={s.shell}>
    <nav className={s.top}><a href="/scanner"><ArrowLeft size={17} aria-hidden="true"/> Volver al scanner</a><span className={s.navStatus}>CIERRES HISTÓRICOS</span></nav>
    <header className={s.hero}><p className={s.kicker}>Momentum Screener · Estrategias</p><h1>Máximos de 52 semanas</h1>
      <p>Busca instrumentos de EE. UU. que marcaron o igualaron su máximo intradía de 52 semanas y negociaron más de 5 millones de acciones en la sesión elegida. No usa datos en vivo. Se excluyen los instrumentos conocidos como no comunes; algunos tipos pueden estar sin verificar.</p></header>
    <section className={s.d3} aria-labelledby="highs-search" aria-busy={view.kind==="loading"}>
      <h2 id="highs-search">Buscar por sesión</h2>
      <form className={s.radarForm} onSubmit={search}>
        <label className={s.label}><span>Fecha de mercado · Nueva York</span><input type="date" required value={date} onChange={e=>{ctrl.current?.abort();setDate(e.target.value);setView({kind:"idle"});}}/></label>
        <button className={s.submit} type="submit" disabled={!date || view.kind==="loading"}><Search size={16} aria-hidden="true"/> {view.kind==="loading"?"Buscando…":"Buscar máximos"}</button>
      </form>
      <div aria-live="polite">
        {view.kind==="error" && <p role="alert" className={s.error}>{view.message}</p>}
        {m && <p>{m.date} · Ventana desde {m.from} · {m.coveredSessions} de {m.requiredSessions} sesiones disponibles.</p>}
        {result?.status==="pending_history" && <p className={s.notice}>Historial pendiente. Se necesitan todas las sesiones antes de confirmar máximos; esto no significa que no haya candidatas.</p>}
        {result?.status==="ready" && <>
          <p>{m.total} coincidencias. {m.universe} {m.insufficientTickerHistory} instrumentos omitidos por historial corto y {m.adjustmentPending} pendientes de ajuste por splits.</p>
          {result.rows.length ? <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Máximos encontrados, tabla desplazable">
            <table className={s.radarTable}><thead><tr>
              <th scope="col">Símbolo</th><th scope="col">Tipo de máximo</th><th scope="col">Cierre (USD)</th><th scope="col">Máximo del día (USD)</th><th scope="col">Máximo previo de 52s (USD)</th><th scope="col">Volumen de la sesión (acciones)</th>
            </tr></thead><tbody>{result.rows.map(row=><tr key={row.symbol}>
              <th scope="row">{row.symbol}{!row.cachedCommon && <small className={s.quiet}> · tipo sin verificar</small>}</th><td>{row.kind==="tie"?"Iguala máximo":"Nuevo máximo"}</td>
              <td>{n(row.close,money)}</td><td>{n(row.sessionHigh,money)}</td><td>{n(row.priorHigh,money)}</td><td>{n(row.shares,shares)}</td>
            </tr>)}</tbody></table>
          </div> : <p>No hubo coincidencias verificables con esos filtros.</p>}
        </>}
      </div>
    </section>
    <p className={s.footer}>Massive · barras diarias ajustadas por splits. Se compara el máximo de la sesión, no su cierre, contra el máximo de las sesiones previas de la ventana. La referencia de tipo disponible no certifica la clasificación histórica; si falta, el símbolo se marca como tipo sin verificar.</p>
  </div></main>;
}
