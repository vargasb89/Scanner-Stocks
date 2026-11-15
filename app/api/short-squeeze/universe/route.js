import { fetchGroupedDay, fetchTickerDailyRange } from "../../../../lib/massive.js";
import { dateOffset, marketDate, validDate } from "../../../../lib/strategies/short-squeeze-data.js";
import { rankShortSqueezeUniverse } from "../../../../lib/strategies/short-squeeze-universe.js";

export const runtime = "nodejs";
const response = (data, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

export async function GET(request) {
  const date = new URL(request.url).searchParams.get("d1")?.trim() || "";
  const latest = dateOffset(marketDate(new Date()), -1);
  if (!validDate(date) || date > latest) {
    return response({ error: "Elige una sesión pasada de Nueva York para D1." }, 400);
  }

  if (!process.env.MASSIVE_API_KEY && !process.env.POLYGON_API_KEY) {
    return response({
      code: "MASSIVE_NOT_CONFIGURED",
      error: "Esta versión del scanner no tiene configurada la conexión a Massive.",
    }, 503);
  }
  try {
    const to = [dateOffset(date, 10), latest].sort()[0];
    const from = dateOffset(date, -10);
    const calendar = await fetchTickerDailyRange("SPY", from, to);
    const sessions = [...new Set(calendar.map((row) => row.date))]
      .filter((day) => validDate(day) && day >= from && day <= to).sort();
    if (!sessions.length) return response({ error: "No se pudo verificar el calendario de mercado." }, 502);
    const index = sessions.indexOf(date);
    if (index <= 0) return response({ error: "No se pudo verificar D1 y su sesión anterior. Revisa la fecha." }, 422);
    const previousDate = sessions[index - 1];
    const nextDate = sessions[index + 1] ?? null;
    const [previousBars, d1Bars, d2Bars] = await Promise.all([
      fetchGroupedDay(previousDate), fetchGroupedDay(date),
      nextDate ? fetchGroupedDay(nextDate).catch(() => null) : null,
    ]);
    if (!previousBars.length || !d1Bars.length) {
      return response({ error: "Massive no devolvió todas las barras necesarias para el radar D1." }, 502);
    }
    const hadD2 = !!d2Bars?.length;
    return response({
      date, previousDate, d2Date: hadD2 ? nextDate : null,
      ...rankShortSqueezeUniverse({ previousBars, d1Bars, d2Bars: hadD2 ? d2Bars : null }),
      warning: hadD2
        ? "Radar preliminar. Falta verificar tipo de activo, flotante, volumen relativo, noticia y ETB. Se ordena por D2 disponible y volumen D1."
        : "D2 no está disponible. La lista solo aplica el filtro de precio D1; el resto se verifica en el análisis por ticker.",
    });
  } catch (error) {
    const diagnostics = {
      401: ["MASSIVE_AUTH_REJECTED", "Massive rechazó la credencial de esta versión del scanner.", 502],
      403: ["MASSIVE_DATA_FORBIDDEN", "Massive no ofrece acceso a estos datos para la conexión o la fecha elegida.", 502],
      429: ["MASSIVE_RATE_LIMITED", "Massive alcanzó su límite de consultas. Intenta de nuevo en un minuto.", 429],
    };
    const [code, message, status] = diagnostics[error?.status] ??
      ["MASSIVE_UNAVAILABLE", "No se pudieron obtener las barras del mercado desde Massive.", 502];
    return response({ error: message, code }, status);
  }
}
