export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* US states + Canadian provinces: abbreviation -> full name, used to disambiguate
   geocoding results (e.g. "Monterey, CA" should be California, not Monterrey MX). */
const REGION = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
  ON: "Ontario", QC: "Quebec", BC: "British Columbia", AB: "Alberta", MB: "Manitoba",
  SK: "Saskatchewan", NS: "Nova Scotia", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  PE: "Prince Edward Island",
};

function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache },
  });
}

async function fetchJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = (searchParams.get("city") || "").trim();
  if (!raw) return json({ error: "Missing ?city" }, 400);

  // "Daytona Beach, FL" -> name "Daytona Beach", region abbr "FL"
  const [namePart, regionPart] = raw.split(",").map((s) => s.trim());
  const wantRegion = regionPart ? REGION[regionPart.toUpperCase()] || regionPart : "";

  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(namePart)}&count=10&language=en&format=json`
  );
  const results = geo?.results || [];
  if (!results.length) return json({ error: "City not found", city: raw }, 404);

  // prefer an exact region match, then US/Canada, then most prominent (first)
  const place =
    results.find((r) => wantRegion && (r.admin1 || "").toLowerCase() === wantRegion.toLowerCase()) ||
    results.find((r) => ["US", "CA"].includes(r.country_code)) ||
    results[0];

  const w = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,weather_code` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`
  );
  const c = w?.current;
  if (!c) return json({ error: "Weather unavailable" }, 502);

  const r0 = (n) => (n == null ? null : Math.round(n));
  return json(
    {
      city: place.name,
      region: place.admin1 || "",
      country: place.country_code || "",
      tempF: r0(c.temperature_2m),
      feelsF: r0(c.apparent_temperature),
      humidity: r0(c.relative_humidity_2m),
      cloudPct: r0(c.cloud_cover),
      precipIn: c.precipitation ?? 0,
      windMph: r0(c.wind_speed_10m),
      code: c.weather_code,
      observedAt: c.time || null,
    },
    200,
    // let the CDN cache per-city for 15 min so we don't hammer the upstream API
    "public, s-maxage=900, stale-while-revalidate=3600"
  );
}
