import { readLoc, geocode, liveOutlook, wttrCurrent, json } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Live conditions + a short hourly outlook (recent past -> now -> next hours).
   Accepts ?lat=&lon=&place=  OR  ?city=  . Open-Meteo primary, wttr.in fallback. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { lat, lon, city, place, haveCoords, locStr } = readLoc(searchParams);
  if (!haveCoords && !city) return json({ error: "Provide lat/lon or city" }, 400);

  try {
    const omTask = (async () => {
      let la = lat, lo = lon, nm = place, rg = "";
      if (!haveCoords) { const g = await geocode(city); if (!g) return null; la = g.lat; lo = g.lon; nm = nm || g.name; rg = g.region; }
      const o = await liveOutlook(la, lo);
      return o ? { ...o, place: nm, region: rg } : null;
    })();
    const wtTask = locStr ? wttrCurrent(locStr) : Promise.resolve(null);

    const [omR, wtR] = await Promise.allSettled([omTask, wtTask]);
    const om = omR.status === "fulfilled" ? omR.value : null;
    const wt = wtR.status === "fulfilled" ? wtR.value : null;
    const best = om || (wt ? { ...wt, place: wt.place || place, region: wt.region || "", hourly: [] } : null);
    if (!best) return json({ error: "Weather unavailable" }, 502);
    return json(best, 200, "no-store");
  } catch {
    return json({ error: "Weather service error" }, 502);
  }
}
