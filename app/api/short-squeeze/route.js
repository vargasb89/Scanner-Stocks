import { loadShortSqueeze } from "@/lib/strategies/short-squeeze-data";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { status, body } = await loadShortSqueeze(new URL(request.url).searchParams);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "No fue posible evaluar la sesión." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
