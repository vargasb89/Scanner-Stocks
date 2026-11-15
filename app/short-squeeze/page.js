"use client";

import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, Search } from 'lucide-react';
import s from './squeeze.module.css';

const CHECK_LABELS = {
  universe: 'Universo · acciones de EE. UU.',
  freeFloat: 'Flotante real de referencia',
  lowFloat: 'Flotante histórico verificado manualmente',
  sharesOutstanding: 'Acciones en circulación · preferiblemente <40 M',
  openingGap: 'Gap de apertura',
  gap: 'Gap de apertura',
  impulse: 'Impulso D1 · +20% a +100% sin gap extremo',
  relativeVolume: 'Volumen relativo diario',
  etbD1: 'Disponibilidad de préstamo D1',
  catalyst: 'Noticia de la empresa o el sector',
  retention: 'Retención D2 · al menos 50% del impulso D1',
  etbD2: 'Disponibilidad de préstamo D2',
};
const CHECK_STATUS = {pass: ['pass', 'Cumple'], fail: ['fail', 'No cumple'], missing: ['unknown', 'Falta dato']};
const OUTCOMES = {
  excluded: ['fail', 'Descartado', 'Al menos un filtro no cumple. Revisa el detalle; el módulo no genera una entrada.'],
  pending: ['unknown', 'Pendiente de confirmar', 'Faltan datos o evidencia. Un dato no disponible no cuenta como aprobado.'],
  observation: ['pass', 'En observación D3+', 'Cumplió la revisión D1/D2 con los datos y confirmaciones aportados. No es una señal de entrada.'],
};
const volume = new Intl.NumberFormat('es-CO', {notation: 'compact', maximumFractionDigits: 2});
const shareCount = new Intl.NumberFormat('es-CO', {maximumFractionDigits: 0});
const number = new Intl.NumberFormat('es-CO', {maximumFractionDigits: 2, minimumFractionDigits: 2});
const money = new Intl.NumberFormat('es-CO', {style: 'currency', currency: 'USD', maximumFractionDigits: 4});
const show = (val, fmt = number) => Number.isFinite(val) ? fmt.format(val) : '—';
const percent = val => Number.isFinite(val) ? show(val) + '%' : '—';
const times = val => Number.isFinite(val) ? show(val) + '×' : '—';
const todayET = () => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(({type,value}) => [type,value]));
  return [byType.year, byType.month, byType.day].join('-');
};
const lastNYWeekday = () => {
  const date = new Date(todayET() + 'T00:00:00Z');
  do { date.setUTCDate(date.getUTCDate() - 1); } while ([0,6].includes(date.getUTCDay()));
  return date.toISOString().slice(0,10);
};
const emptyEvidence = () => ({lowFloat:'unverified', floatSource:'', etbD1:'unverified', etbD2:'unverified', catalyst:'unverified', source:'', published:''});

function CheckSelect({label, value, onChange}) {
  return <label className={s.label}>
    <span>{label}</span>
    <select value={value} onChange={e=>onChange(e.target.value)}>
      <option value="unverified">Sin verificar</option>
      <option value="yes">Sí, verificado</option>
      <option value="no">No, verificado</option>
    </select>
  </label>;
}
function Stats({heading, date, entries}) {
  return <div className={s.day}>
    <h3>{heading}<small>{date || 'Sin sesión'}</small></h3>
    <dl className={s.stats}>{entries.map(([label,value]) =>
      <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
    )}</dl>
  </div>;
}
function checkValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return show(value);
  if (value === true || value === 'yes') return 'Sí';
  if (value === false || value === 'no') return 'No';
  return '';
}
function safeLink(raw) {
  try { const url = new URL(raw); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function EvidenceNews({data}) {
  const collection = data?.news;
  const items = Array.isArray(collection) ? collection : collection?.items;
  if (!items?.length) return null;
  return <div className={s.news}>
    <h3>Noticias disponibles para revisar</h3>
    <p>Una noticia listada no confirma por sí sola el catalizador.</p>
    <ul>{items.slice(0,6).map((item,i) => {
      const href = safeLink(item.url || item.article_url);
      return <li key={item.id || i}>
        {href ? <a className={s.link} href={href} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
        {(item.published || item.published_utc) && <time>{item.published || item.published_utc}</time>}
      </li>;
    })}</ul>
  </div>;
}
function Result({result,sourced}) {
  const [kind,label,summary] = OUTCOMES[result.status] ?? OUTCOMES.pending;
  const m = result.metrics ?? {};
  const day2mode = result.settings?.retentionMode;
  const warnings = [...new Set([...(Array.isArray(result.data?.warnings)?result.data.warnings:[]), ...(Array.isArray(result.warnings)?result.warnings:[])].filter(v => typeof v === 'string'))];
  return <>
    <div className={s.resultHeader}>
      <div className={s.sectionTop}>
        <h2 id="result-title">{result.symbol} · revisión histórica</h2>
        <b className={s.status} data-kind={kind}>{label}</b>
      </div>
      <p>{summary}</p>
    </div>
    <div className={s.dayGrid}>
      <Stats heading="D1 · impulso" date={result.d1Date} entries={[
        ['Vs. cierre previo', percent(m.d1ChangePct)], ['Gap de apertura', percent(m.d1OpenGapPct ?? m.openGapPct)],
        ['Cierre anterior', show(m.previousClose,money)], ['Cierre D1', show(m.d1Close,money)],
        ['Máximo D1', show(m.d1High,money)], ['Volumen', show(m.d1Volume,volume)],
        ['RVOL diario', times(m.relativeVolume)], ['Sesiones para RVOL', Number.isFinite(m.volumeSamples) ? m.volumeSamples : '—'],
        ['Flotante real', show(m.freeFloat,volume)], ['Acciones emitidas (no flotante)', show(m.sharesOutstanding,volume)],
      ]}/>
      <Stats heading="D2 · retención" date={result.d2Date} entries={[
        ['Piso de retención', show(m.retentionFloor,money)], ['Mínimo D2', show(m.d2Low,money)],
        ['Cierre D2', show(m.d2Close,money)], [day2mode==='low'?'Retención por mínimo · usada':'Retención por mínimo', percent(m.d2LowRetentionPct)],
        [day2mode==='close'?'Retención por cierre · usada':'Retención por cierre', percent(m.d2CloseRetentionPct)],
      ]}/>
    </div>
    <h3>Filtros de la estrategia</h3>
    <ul className={s.checkList}>
      {(Array.isArray(result.checks)?result.checks:[]).map(check=>{
        const [key,status] = CHECK_STATUS[check.status] || CHECK_STATUS.missing;
        const note = check.advisory && typeof check.advisory !== 'string' ? 'Referencia; no sustituye una confirmación.' : String(check.advisory || '');
        const value = checkValue(check.value);
        return <li key={check.id}>
          <strong>{CHECK_LABELS[check.id] || check.id}</strong>
          <span className={s.checkBadge} data-kind={check.advisory ? undefined : key}>{check.advisory ? 'Referencia' : status}</span>
          {(note || value) && <small>{value && !note ? 'Dato: ' + value : note}</small>}
        </li>;
      })}
    </ul>
    {!result.d2Date && <p className={s.notice}>{result.data?.expectedD2 ? 'No hay vela del símbolo para D2 (' + result.data.expectedD2 + ').' : 'No hay sesión D2 verificable en los datos recibidos.'}</p>}
    {result.data?.calendarStatus==='not_market_session' && <p className={s.notice}>La fecha D1 seleccionada no aparece como sesión del mercado.</p>}
    {result.data?.calendarStatus==='unavailable' && <p className={s.notice}>No se pudo verificar el calendario de sesiones; no se supone D2.</p>}
    {result.data?.calendarStatus==='available' && result.data?.barsStatus!=='available' && <p className={s.notice}>No hay vela D1 del símbolo para la sesión seleccionada.</p>}
    {sourced?.lowFloat==='yes' && <p className={s.notice}>Flotante histórico marcado manualmente: {sourced.floatSource}. No se envía al servidor.</p>}
    {sourced?.catalyst==='yes' && <p className={s.notice}>Noticia marcada manualmente: {sourced.source} · {sourced.published} ET. No se envía al servidor.</p>}
    {warnings.map(w => <p className={s.notice} key={w}>{w}</p>)}
    <EvidenceNews data={result.data}/>
  </>;
}

export default function ShortSqueezePage() {
  const [symbol,setSymbol] = useState('');
  const [d1,setD1] = useState('');
  const [retentionMode,setRetention] = useState('low');
  const [rvolThreshold,setRvol] = useState('3');
  const [evidence,setEvidence] = useState(emptyEvidence);
  const [view,setView] = useState({kind:'idle'});
  const [radar,setRadar] = useState({kind:'idle'});
  const detailAbort = useRef(null);
  const radarAbort = useRef(null);
  const tickerInput = useRef(null);
  const detailPanel = useRef(null);
  useEffect(() => {
    setD1(lastNYWeekday());
    return () => { detailAbort.current?.abort(); radarAbort.current?.abort(); };
  },[]);
  function selectCandidate(value) {
    setTicker(value);
    if (detailPanel.current) detailPanel.current.open = true;
    requestAnimationFrame(() => tickerInput.current?.focus());
  }
  function invalidate() { detailAbort.current?.abort(); setView({kind:'idle'}); }
  function setTicker(value) {
    const next = value.toUpperCase();
    if (next === symbol) return;
    setSymbol(next);
    setEvidence(emptyEvidence());
    invalidate();
  }
  function setDate(value) {
    setD1(value);
    setEvidence(emptyEvidence());
    invalidate();
    radarAbort.current?.abort();
    setRadar({kind:'idle'});
  }
  function updateEvidence(name,value){
    setEvidence(prev=>({...prev,[name]:value}));
    invalidate();
  }
  async function analyze(e) {
    e.preventDefault();
    detailAbort.current?.abort();
    const code = symbol.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(code)) {
      setView({kind:'error',message:'Ingresa un símbolo válido, por ejemplo AAPL.'});
      return;
    }
    if (!d1 || d1 >= todayET()) {
      setView({kind:'error',message:'Elige una fecha D1 anterior a hoy en Nueva York.'});
      return;
    }
    const rvol = Number(rvolThreshold);
    if (!rvolThreshold.trim() || !Number.isFinite(rvol) || rvol <= 0) {
      setView({kind:'error',message:'Ingresa un mínimo de volumen relativo mayor a cero.'});
      return;
    }
    if(evidence.lowFloat === 'yes' && !evidence.floatSource.trim()){
      setView({kind:'error',message:'Indica la fuente utilizada para verificar el flotante histórico de D1.'});
      return;
    }
    if(evidence.catalyst === 'yes' && (!evidence.source.trim() || !evidence.published)){
      setView({kind:'error',message:'Para confirmar el catalizador, indica la fuente y la hora de publicación (ET).'});
      return;
    }
    if(evidence.catalyst === 'yes' && evidence.published.slice(0,10) > d1){
      setView({kind:'error',message:'La fuente del catalizador debe estar publicada hasta D1; no uses noticias posteriores.'});
      return;
    }
    const params = new URLSearchParams({
      symbol:code,d1,retentionMode,rvolThreshold,
      etbD1:evidence.etbD1,etbD2:evidence.etbD2,catalyst:evidence.catalyst,lowFloat:evidence.lowFloat,
    });
    const controller = new AbortController();
    detailAbort.current = controller;
    setView({kind:'loading'});
    try {
      const response = await fetch('/api/short-squeeze?' + params,{signal:controller.signal,cache:'no-store'});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la estrategia.');
      if (!controller.signal.aborted) setView({kind:'result',result:data,sourced:evidence});
    } catch (error) {
      if (!controller.signal.aborted) setView({kind:'error',message:error?.message || 'La consulta no está disponible.'});
    }
  }
  async function marketRadar(e) {
    e.preventDefault();
    radarAbort.current?.abort();
    if (!d1 || d1 >= todayET()) { setRadar({kind:'error',message:'Elige primero una fecha D1 válida.'}); return; }
    const controller=new AbortController();
    radarAbort.current=controller;
    setRadar({kind:'loading'});
    try {
      const response=await fetch('/api/short-squeeze/universe?' + new URLSearchParams({d1}),{signal:controller.signal,cache:'no-store'});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error || 'No se pudo consultar el universo.');
      if(!controller.signal.aborted) setRadar({kind:'result',data});
    } catch(error){
      if(!controller.signal.aborted) setRadar({kind:'error',message:error?.message || 'La consulta no está disponible.'});
    }
  }
  const radarRows = Array.isArray(radar.data?.rows) ? radar.data.rows.slice(0,35) : [];
  const maxD1 = view.kind === 'result' && Number.isFinite(view.result?.d3?.referencePrice) ? view.result.d3.referencePrice : null;
  return <main className={s.page}><div className={s.shell}>
    <nav className={s.top} aria-label="Navegación de estrategias">
      <a href="/scanner"><ArrowLeft size={17} aria-hidden="true"/> Volver al scanner</a>
      <span className={s.navStatus}>SOLO OBSERVACIÓN Y REPLAY</span>
    </nav>
    <header className={s.hero}>
      <p className={s.kicker}>Momentum Screener · Estrategias</p>
      <h1>Short Squeeze</h1>
      <p>Encuentra candidatas en el mercado de EE. UU. y luego revisa cuáles cumplen tu estrategia.</p>
    </header>
    <section className={s.d3} aria-labelledby="radar-title" aria-busy={radar.kind==='loading'}>
      <h2 id="radar-title">1 · Buscar candidatas en el mercado</h2>
      <p><strong>No necesitas un ticker.</strong> Elige la fecha del impulso (D1) y el radar busca por ti.</p>
      <form className={s.radarForm} onSubmit={marketRadar}>
        <label className={s.label}>
          <span>Fecha D1 · Nueva York</span>
          <input name="d1" type="date" required value={d1} onChange={e=>setDate(e.target.value)}/>
        </label>
        <button type="submit" className={s.submit} disabled={!d1 || radar.kind==='loading'}><Search size={16} aria-hidden="true"/> {radar.kind==='loading'?'Buscando…':'Buscar candidatas D1/D2'}</button>
      </form>
      <p>El radar busca subidas de +20% a +100% en D1 y comprueba si el mínimo de D2 retuvo al menos la mitad. Si D2 aún no está disponible, la candidata queda pendiente. El radar no confirma por sí solo el tipo de acción, el gap, el volumen relativo, el flotante, la noticia ni el préstamo.</p>
      <div aria-live="polite">
        {radar.kind==='error' && <p className={s.error} role="alert">{radar.message}</p>}
        {radar.kind==='result' && <>
          <p>{radar.data.date || d1} · {Number.isFinite(radar.data.total) ? radar.data.total : radarRows.length} candidatas preliminares{radarRows.length ? ' · mostrando ' + radarRows.length : ''}{radar.data.d2Date ? ' · D2 ' + radar.data.d2Date : ' · D2 sin sesión disponible'}</p>
          {radar.data.warning && <p className={s.notice}>{radar.data.warning}</p>}
          {radarRows.length>0 ? <><p>Volumen histórico de la sesión, en acciones. No es volumen intradía ni volumen relativo (RVOL). Selecciona un símbolo para ver la revisión individual.</p><div className={s.tableWrap} tabIndex={0} role="region" aria-label="Candidatas del radar, tabla desplazable">
            <table className={s.radarTable}>
              <thead><tr><th scope="col">Símbolo</th><th scope="col">D1</th><th scope="col">Vol. D1 (acciones)</th><th scope="col">Vol. D2 (acciones)</th><th scope="col">Máximo D1</th><th scope="col">Cierre D1</th><th scope="col">Retención D2</th></tr></thead>
              <tbody>{radarRows.map(row=><tr key={row.symbol}>
                <th scope="row"><button type="button" className={s.symbolButton} aria-label={'Revisar ' + row.symbol} onClick={()=>selectCandidate(row.symbol)}>{row.symbol}</button></th>
                <td>{percent(row.changePct)}</td><td>{show(row.d1Volume,shareCount)}</td><td>{Number.isFinite(row.d2Volume) ? show(row.d2Volume,shareCount) : 'Pendiente'}</td><td>{show(row.high,money)}</td><td>{show(row.close,money)}</td><td>{percent(row.d2RetentionPct)}</td>
              </tr>)}</tbody>
            </table>
          </div></> : <p>No se encontraron candidatas con estos filtros.</p>}
        </>}
      </div>
    </section>
    <details ref={detailPanel} className={s.detailPanel}>
      <summary>2 · Revisar una candidata (opcional)</summary>
      <p>Abre una candidata del radar o escribe un símbolo específico. Aquí se comprueban los filtros que faltan.</p>
    <div className={s.grid}>
      <section className={s.card} aria-labelledby="setup-title">
        <h2 id="setup-title">Revisión por símbolo</h2>
        <form className={s.form} onSubmit={analyze}>
          <div className={s.fields}>
            <label className={s.label}>
              <span>Símbolo</span>
              <input ref={tickerInput} name="symbol" type="text" maxLength={15} required placeholder="Ej. AAPL" autoComplete="off" spellCheck="false" value={symbol} onChange={e=>setTicker(e.target.value)}/>
            </label>
            <label className={s.label}>
              <span>Fecha D1 seleccionada</span>
              <input type="text" readOnly value={d1 || 'No seleccionada'}/>
            </label>
          </div>
          <fieldset>
            <legend>Confirmación manual · evidencia de esa sesión</legend>
            <div className={s.fields}>
              <CheckSelect label="Préstamo (ETB) D1" value={evidence.etbD1} onChange={value=>updateEvidence('etbD1',value)}/>
              <CheckSelect label="Préstamo (ETB) D2" value={evidence.etbD2} onChange={value=>updateEvidence('etbD2',value)}/>
              <div className={s.full}><CheckSelect label="Flotante bajo verificado en D1" value={evidence.lowFloat} onChange={value=>updateEvidence('lowFloat',value)}/></div>
              {evidence.lowFloat==='yes' && <label className={s.label + ' ' + s.full}><span>Fuente del flotante histórico (vigente en D1)</span><input type="text" required maxLength={200} placeholder="Bróker o informe del flotante efectivo" value={evidence.floatSource} onChange={e=>updateEvidence('floatSource',e.target.value)}/></label>}
              <div className={s.full}><CheckSelect label="Catalizador de empresa o sector" value={evidence.catalyst} onChange={value=>updateEvidence('catalyst',value)}/></div>
              {evidence.catalyst==='yes' && <>
                <label className={s.label}><span>Fuente de la noticia</span><input required type="text" maxLength={200} placeholder="Medio, comunicado o URL" value={evidence.source} onChange={e=>updateEvidence('source',e.target.value)}/></label>
                <label className={s.label}><span>Publicada el · hora ET</span><input required type="datetime-local" value={evidence.published} onChange={e=>updateEvidence('published',e.target.value)}/></label>
              </>}
              <small className={s.quiet + ' ' + s.full}>Confirmar con el bróker para D1 y D2. La disponibilidad actual no demuestra la histórica. No uses acciones emitidas como flotante. Las fuentes escritas no se almacenan.</small>
            </div>
          </fieldset>
          <details className={s.details}>
            <summary>Ver reglas ajustables</summary>
            <div className={s.fields}>
              <label className={s.label}>
                <span>RVOL mínimo</span>
                <input type="number" min="1" max="100" step=".1" required value={rvolThreshold} onChange={e=>{setRvol(e.target.value);invalidate();}}/>
              </label>
              <label className={s.label}>
                <span>Retención D2</span>
                <select value={retentionMode} onChange={e=>{setRetention(e.target.value);invalidate();}}>
                  <option value="low">Mínimo intradía (conservador)</option>
                  <option value="close">Cierre de la sesión</option>
                </select>
              </label>
              <small className={s.quiet + ' ' + s.full}>El piso es cierre previo + 50% de la subida al cierre de D1. Las fechas corresponden a sesiones de mercado, no a días corridos.</small>
            </div>
          </details>
          <button type="submit" className={s.submit} disabled={view.kind==='loading'}><Search size={16} aria-hidden="true"/>{view.kind==='loading'?'Consultando…':'Revisar D1 y D2'}</button>
        </form>
      </section>
      <section className={s.card} aria-labelledby="result-title" aria-live="polite" aria-busy={view.kind==='loading'}>
        {view.kind==='result' ? <Result result={view.result} sourced={view.sourced}/> : <>
          <h2 id="result-title">Resultado de la revisión</h2>
          {view.kind==='error' ? <p className={s.error} role="alert">{view.message}</p> :
            <div className={s.placeholder}><Activity size={30} aria-hidden="true"/>
              <strong>{view.kind==='loading'?'Consultando sesiones diarias':'Todavía no hay una revisión'}</strong>
              <p>{view.kind==='loading'?'Estamos comprobando el impulso y la retención disponibles.':'Elige un símbolo y la fecha del impulso. Si no tienes evidencia de préstamo o del catalizador, déjalos sin verificar.'}</p>
            </div>}
        </>}
      </section>
    </div>
    </details>
    <section className={s.d3} aria-labelledby="d3-title">
      <h2 id="d3-title">3 · D3 en adelante: revisión en tu bróker</h2>
      <p>Checklist discrecional. El módulo no confirma patrones intradía, no simula ejecuciones y no envía órdenes.</p>
      <ul>
        <li>Observa velas de 1 o 5 minutos; comprueba <strong>Level 2 y Time &amp; Sales</strong>. No se sustituyen con OHLCV.</li>
        <li>Revisa rectángulo con mínimos crecientes, bandera alcista o ataque al máximo de D1, junto con volumen.</li>
        <li>{maxD1===null?'El máximo de D1 se muestra como referencia cuando hay datos.':'Máximo de D1: '+show(maxD1,money)+' · referencia de observación, no una entrada.'} Que el precio toque ese nivel no demuestra que una orden habría sido ejecutada.</li>
      </ul>
    </section>
    <p className={s.footer}>Massive · datos según cobertura del plan. Sin clave en el navegador, alertas en vivo ni integración con bróker.</p>
  </div></main>;
}
