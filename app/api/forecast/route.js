import { readLoc, geocode, raceDay, wttrForecast, json } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Race-day forecast for a given date. Accepts ?date=YYYY-MM-DD and either
   ?lat=&lon=&place=  OR  ?city=
   Returns a real forecast when the race is within range, otherwise the same
   calendar date from prior years (seasonal expectation). wttr.in is a fallback. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let { lat, lon, city, place, haveCoords, locStr } = readLoc(searchParams);
  const date = searchParams.get("date");
  if (!date) return json({ error: "forecast needs ?date=YYYY-MM-DD" }, 400);
  if (!haveCoords && !city) return json({ error: "Provide lat/lon or city" }, 400);

  try {
    let region = "";
    if (!haveCoords) {
      const g = await geocode(city);
      if (g) { lat = g.lat; lon = g.lon; place = place || g.name; region = g.region; haveCoords = true; }
    }

    let f = haveCoords ? await raceDay(lat, lon, date) : null;
    if (!f && locStr) f = await wttrForecast(locStr, date); // fallback for near-term dates
    if (!f) return json({ error: "No forecast available" }, 502);

    return json({ place, region, ...f }, 200, "public, s-maxage=3600, stale-while-revalidate=21600");
  } catch {
    return json({ error: "Forecast service error" }, 502);
  }
}
