import { readLoc, geocode, raceDayOutlook, json } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Race-day forecast + hourly outlook around the 8 PM ET start. Real forecast only
   (no prior-year fill); returns { available:false } when the race is >~2 weeks out.
   Accepts ?date=YYYY-MM-DD and ?lat=&lon=&place=  OR  ?city= . */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let { lat, lon, city, place, haveCoords } = readLoc(searchParams);
  const date = searchParams.get("date");
  if (!date) return json({ error: "forecast needs ?date=YYYY-MM-DD" }, 400);
  if (!haveCoords && !city) return json({ error: "Provide lat/lon or city" }, 400);

  try {
    let region = "";
    if (!haveCoords) {
      const g = await geocode(city);
      if (g) { lat = g.lat; lon = g.lon; place = place || g.name; region = g.region; haveCoords = true; }
    }
    if (!haveCoords) return json({ error: "City not found", city }, 404);

    const o = await raceDayOutlook(lat, lon, date);
    return json({ place, region, ...o }, 200, "no-store");
  } catch {
    return json({ error: "Forecast service error" }, 502);
  }
}
