/* Server-side weather helpers shared by /api/weather (live) and /api/forecast
   (race-day). Sources are free, public, and need no API key:
   Open-Meteo (primary) + wttr.in (fallback). */

export const REGION = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas",
  UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia", ON: "Ontario", QC: "Quebec",
  BC: "British Columbia", AB: "Alberta", MB: "Manitoba", SK: "Saskatchewan", NS: "Nova Scotia",
  NB: "New Brunswick", NL: "Newfoundland and Labrador", PE: "Prince Edward Island",
};
const TZ = "America%2FNew_York";
const UNITS = "temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";

export const r0 = (n) => (n == null || isNaN(n) ? null : Math.round(n));

export function json(body, status = 200, cache = "no-store") {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": cache },
  });
}

export async function fetchJson(url, ms = 4500, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json", "user-agent": "hcr-league-weather/1.0", ...headers } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

/* Read lat/lon/city/place from a URL's search params into a normalized shape. */
export function readLoc(searchParams) {
  const lat = parseFloat(searchParams.get("lat"));
  const lon = parseFloat(searchParams.get("lon"));
  const city = (searchParams.get("city") || "").trim();
  const place = searchParams.get("place") || "";
  const haveCoords = !isNaN(lat) && !isNaN(lon);
  const locStr = city || (haveCoords ? `${lat},${lon}` : "");
  return { lat, lon, city, place, haveCoords, locStr };
}

/* Open-Meteo geocoding (only needed when coordinates aren't supplied). */
export async function geocode(raw) {
  const [namePart, regionPart] = raw.split(",").map((s) => s.trim());
  const want = regionPart ? REGION[regionPart.toUpperCase()] || regionPart : "";
  const geo = await fetchJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(namePart)}&count=10&language=en&format=json`, 4000);
  const results = geo?.results || [];
  if (!results.length) return null;
  const p =
    results.find((x) => want && (x.admin1 || "").toLowerCase() === want.toLowerCase()) ||
    results.find((x) => ["US", "CA"].includes(x.country_code)) ||
    results[0];
  return { lat: p.latitude, lon: p.longitude, name: p.name, region: p.admin1 || "" };
}

/* Current conditions (Open-Meteo) */
export async function omCurrent(lat, lon) {
  const w = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,weather_code` +
    `&${UNITS}&timezone=auto`, 4000);
  const c = w?.current;
  if (!c) return null;
  return {
    source: "open-meteo", tempF: r0(c.temperature_2m), feelsF: r0(c.apparent_temperature),
    humidity: r0(c.relative_humidity_2m), cloudPct: r0(c.cloud_cover),
    precipIn: c.precipitation ?? 0, windMph: r0(c.wind_speed_10m),
    code: c.weather_code, observedAt: c.time || null,
  };
}

/* Current conditions (wttr.in) — takes a location string; no geocode needed */
export async function wttrCurrent(locStr) {
  const j = await fetchJson(`https://wttr.in/${encodeURIComponent(locStr)}?format=j1`, 4500);
  const cur = j?.current_condition?.[0];
  if (!cur) return null;
  const area = j?.nearest_area?.[0];
  return {
    source: "wttr.in",
    tempF: r0(+cur.temp_F), feelsF: r0(+cur.FeelsLikeF), humidity: r0(+cur.humidity),
    cloudPct: r0(+cur.cloudcover), precipIn: +cur.precipInches || 0, windMph: r0(+cur.windspeedMiles),
    desc: cur.weatherDesc?.[0]?.value || "", observedAt: cur.localObsDateTime || null,
    place: area?.areaName?.[0]?.value || "", region: area?.region?.[0]?.value || "",
  };
}

/* Race-day weather at ~8 PM ET: real forecast if within range, else the same
   calendar date from prior years (seasonal expectation) via the archive API. */
export async function raceDay(lat, lon, dateStr) {
  const daysAhead = Math.floor((new Date(dateStr + "T12:00:00Z") - Date.now()) / 86400000);
  const pull = async (useDate, mode) => {
    const base = mode === "forecast" ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
    const hourly = mode === "forecast"
      ? "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,precipitation_probability,cloud_cover,wind_speed_10m,weather_code"
      : "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m";
    const daily = mode === "forecast"
      ? "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code"
      : "temperature_2m_max,temperature_2m_min,precipitation_sum";
    const data = await fetchJson(
      `${base}?latitude=${lat}&longitude=${lon}&start_date=${useDate}&end_date=${useDate}` +
      `&hourly=${hourly}&daily=${daily}&${UNITS}&timezone=${TZ}`, 4500);
    const h = data?.hourly;
    if (!h || !h.time) return null;
    let idx = h.time.indexOf(`${useDate}T20:00`);
    if (idx < 0) idx = Math.min(20, h.time.length - 1);
    const d = data.daily || {};
    return {
      mode, date: useDate,
      tempF: r0(h.temperature_2m?.[idx]), feelsF: r0(h.apparent_temperature?.[idx]),
      humidity: r0(h.relative_humidity_2m?.[idx]), cloudPct: r0(h.cloud_cover?.[idx]),
      precipProb: h.precipitation_probability?.[idx] ?? null,
      precipIn: h.precipitation?.[idx] ?? null, windMph: r0(h.wind_speed_10m?.[idx]),
      code: h.weather_code?.[idx],
      highF: r0(d.temperature_2m_max?.[0]), lowF: r0(d.temperature_2m_min?.[0]),
      precipSumIn: d.precipitation_sum?.[0] ?? null,
    };
  };
  if (daysAhead <= 15 && daysAhead >= -1) { const r = await pull(dateStr, "forecast"); if (r) return r; }
  for (let back = 1; back <= 2; back++) {
    const y = Number(dateStr.slice(0, 4)) - back;
    const r = await pull(y + dateStr.slice(4), "historical");
    if (r) return { ...r, sourceYear: y };
  }
  return null;
}

/* Race-day forecast fallback (wttr.in, ~3-day window) */
export async function wttrForecast(locStr, dateStr) {
  const j = await fetchJson(`https://wttr.in/${encodeURIComponent(locStr)}?format=j1`, 4500);
  const day = (j?.weather || []).find((d) => d.date === dateStr);
  if (!day) return null;
  const slot = (day.hourly || []).find((h) => h.time === "2100") || (day.hourly || [])[7] || {};
  return {
    source: "wttr.in", mode: "forecast", date: dateStr,
    tempF: r0(+slot.tempF), feelsF: r0(+slot.FeelsLikeF), humidity: r0(+slot.humidity),
    cloudPct: r0(+slot.cloudcover),
    precipProb: slot.chanceofrain != null ? +slot.chanceofrain : null,
    precipIn: +slot.precipInches || null, windMph: r0(+slot.windspeedMiles),
    desc: slot.weatherDesc?.[0]?.value || "", highF: r0(+day.maxtempF), lowF: r0(+day.mintempF),
  };
}

/* ---- Hourly "outlook" builders (windowed hourly series, times in ET) ---- */

/* Race-day outlook: real forecast only (no prior-year fallback). Returns
   { available:false } when the race is outside the ~16-day forecast window. */
export async function raceDayOutlook(lat, lon, dateStr) {
  const daysAhead = Math.floor((new Date(dateStr + "T12:00:00Z") - Date.now()) / 86400000);
  if (daysAhead > 15 || daysAhead < -1) return { available: false, reason: daysAhead < 0 ? "past" : "out_of_range", daysAhead };
  // Open-Meteo defaults to 7 forecast days — forecast_days=16 is required to reach ~2 weeks out.
  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&forecast_days=16` +
    `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,cloud_cover,wind_speed_10m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min&${UNITS}&timezone=${TZ}`, 5500);
  const h = data?.hourly;
  if (!h?.time) return { available: false, reason: "unavailable", daysAhead };
  const dayIdx = [];
  for (let i = 0; i < h.time.length; i++) if (String(h.time[i]).slice(0, 10) === dateStr) dayIdx.push(i);
  if (!dayIdx.length) return { available: false, reason: "unavailable", daysAhead };
  let idx = dayIdx.find((i) => String(h.time[i]).slice(11, 13) === "20");
  if (idx == null) idx = dayIdx[Math.min(20, dayIdx.length - 1)];
  const from = Math.max(dayIdx[0], idx - 4), to = Math.min(dayIdx[dayIdx.length - 1], idx + 4);
  const hourly = [];
  for (let i = from; i <= to; i++) hourly.push({
    t: h.time[i], tempF: r0(h.temperature_2m?.[i]), cloudPct: r0(h.cloud_cover?.[i]),
    precipProb: h.precipitation_probability?.[i] ?? null, windMph: r0(h.wind_speed_10m?.[i]), code: h.weather_code?.[i],
  });
  const d = data.daily || {};
  let di = 0;
  if (d.time) { const j = d.time.indexOf(dateStr); if (j >= 0) di = j; }
  return {
    available: true, daysAhead,
    at: {
      tempF: r0(h.temperature_2m?.[idx]), feelsF: r0(h.apparent_temperature?.[idx]),
      humidity: r0(h.relative_humidity_2m?.[idx]), cloudPct: r0(h.cloud_cover?.[idx]),
      precipProb: h.precipitation_probability?.[idx] ?? null, windMph: r0(h.wind_speed_10m?.[idx]),
      code: h.weather_code?.[idx], highF: r0(d.temperature_2m_max?.[di]), lowF: r0(d.temperature_2m_min?.[di]),
    },
    hourly, markerIdx: idx - from, markerLabel: "Race",
  };
}

/* Live outlook: current conditions + a window of recent-past and upcoming hours. */
export async function liveOutlook(lat, lon) {
  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,cloud_cover,wind_speed_10m,weather_code` +
    `&hourly=temperature_2m,precipitation_probability,cloud_cover,wind_speed_10m,weather_code` +
    `&past_days=1&forecast_days=2&${UNITS}&timezone=${TZ}`, 4800);
  const c = data?.current, h = data?.hourly;
  if (!c) return null;
  let hourly = [], markerIdx = 0;
  if (h?.time) {
    const nowKey = (c.time || "").slice(0, 13);
    let idx = h.time.findIndex((t) => t.slice(0, 13) === nowKey);
    if (idx < 0) idx = h.time.findIndex((t) => t >= (c.time || ""));
    if (idx < 0) idx = 0;
    const from = Math.max(0, idx - 3), to = Math.min(h.time.length - 1, idx + 5);
    for (let i = from; i <= to; i++) hourly.push({
      t: h.time[i], tempF: r0(h.temperature_2m?.[i]), cloudPct: r0(h.cloud_cover?.[i]),
      precipProb: h.precipitation_probability?.[i] ?? null, windMph: r0(h.wind_speed_10m?.[i]), code: h.weather_code?.[i],
    });
    markerIdx = idx - from;
  }
  return {
    source: "open-meteo",
    tempF: r0(c.temperature_2m), feelsF: r0(c.apparent_temperature), humidity: r0(c.relative_humidity_2m),
    cloudPct: r0(c.cloud_cover), precipIn: c.precipitation ?? 0, windMph: r0(c.wind_speed_10m),
    code: c.weather_code, observedAt: c.time || null, hourly, markerIdx, markerLabel: "Now",
  };
}
