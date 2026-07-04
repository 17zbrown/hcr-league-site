import { readLoc, geocode, omCurrent, wttrCurrent, json } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Live / current conditions. Accepts ?lat=&lon=&place=  OR  ?city=
   Runs Open-Meteo and wttr.in in parallel and prefers Open-Meteo. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { lat, lon, city, place, haveCoords, locStr } = readLoc(searchParams);
  if (!haveCoords && !city) return json({ error: "Provide lat/lon or city" }, 400);

  try {
    const omTask = (async () => {
      let la = lat, lo = lon, nm = place, rg = "";
      if (!haveCoords) { const g = await geocode(city); if (!g) return null; la = g.lat; lo = g.lon; nm = nm || g.name; rg = g.region; }
      const c = await omCurrent(la, lo);
      return c ? { ...c, place: nm, region: rg } : null;
    })();
    const wtTask = locStr ? wttrCurrent(locStr) : Promise.resolve(null);

    const [omR, wtR] = await Promise.allSettled([omTask, wtTask]);
    const om = omR.status === "fulfilled" ? omR.value : null;
    const wt = wtR.status === "fulfilled" ? wtR.value : null;
    const best = om || (wt ? { ...wt, place: wt.place || place, region: wt.region || "" } : null);
    if (!best) return json({ error: "Weather unavailable" }, 502);
    return json(best, 200, "public, s-maxage=900, stale-while-revalidate=3600");
  } catch {
    return json({ error: "Weather service error" }, 502);
  }
}
