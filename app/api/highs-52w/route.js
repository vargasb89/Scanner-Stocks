import { unstable_cache } from "next/cache";
import { fetch52Sessions, fetch52Splits, loadHighs52 } from "../../../lib/strategies/highs-52w-data.js";

export const runtime = "nodejs";
const getSessions = unstable_cache(fetch52Sessions, ["highs-52w-calendar-v1"], { revalidate: 86_400 });
const getSplits = unstable_cache(fetch52Splits, ["highs-52w-splits-v1"], { revalidate: 3_600 });

export async function GET(request) {
  const { status, body } = await loadHighs52(new URL(request.url).searchParams.get("date") ?? "", { getSessions, getSplits });
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
