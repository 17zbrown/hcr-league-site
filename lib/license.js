/* Shared HCR racing-license computation, used by both the public site and the
   admin. A computed FIA/iRacing-style license per driver from their league
   record: qualifying + pace, race results, incident cleanliness, and starts
   (experience). Position inputs are class-relative so classes compare fairly. */

export const LICENSE_TIERS = [
  { name: "Platinum", min: 88, color: "#DCE3EA" },
  { name: "Gold", min: 74, color: "#F5C542" },
  { name: "Silver", min: 58, color: "#AEB8C4" },
  { name: "Bronze", min: 0, color: "#CB8452" },
];
export const LICENSE_GATE = { Platinum: 8, Gold: 5, Silver: 3 };

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function lapToSeconds(t) {
  if (!t) return null;
  const m = String(t).match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

export function driverLicense(driver, events) {
  const races = [];
  (events || []).forEach((ev) => {
    if (!ev.results || !ev.results.length) return;
    const r = ev.results.find((x) => String(x.num) === String(driver.num) && x.cls === driver.cls) ||
      (slug(driver.name).length > 3 ? ev.results.find((x) => slug(x.drivers).includes(slug(driver.name))) : null);
    if (r) races.push({ ev, r });
  });
  const starts = races.length;
  if (!starts) return { tier: "Unranked", color: "#6b7686", rating: null, pace: null, results: null, safety: null, starts: 0, provisional: true };

  let finishSum = 0, finishN = 0, gridSum = 0, gridN = 0, wins = 0, podiums = 0, poles = 0, fastLaps = 0, incTotal = 0;
  races.forEach(({ ev, r }) => {
    const cp = Number(r.clsPos);
    if (cp) { finishSum += cp; finishN++; if (cp === 1) wins++; if (cp <= 3) podiums++; }
    incTotal += Number(r.inc) || 0;
    const sameCls = (ev.results || []).filter((y) => y.cls === r.cls);
    const grids = sameCls.map((y) => Number(y.grid)).filter((n) => !isNaN(n) && n > 0);
    const g = Number(r.grid);
    if (!isNaN(g) && g > 0 && grids.length) {
      gridSum += grids.filter((x) => x < g).length + 1; gridN++;
      if (g === Math.min(...grids)) poles++;
    }
    const s = lapToSeconds(r.best);
    const secs = sameCls.map((y) => lapToSeconds(y.best)).filter((v) => v != null);
    if (s != null && secs.length && s === Math.min(...secs)) fastLaps++;
  });
  const avgFinish = finishN ? finishSum / finishN : null;
  const avgGrid = gridN ? gridSum / gridN : null;
  const incPerRace = incTotal / starts;

  const posScore = (p) => p == null ? 55 : Math.max(0, Math.min(100, 104 - p * 11));
  const results = Math.min(100, posScore(avgFinish) + wins * 4 + podiums * 2);
  const pace = Math.min(100, posScore(avgGrid) + poles * 4 + fastLaps * 3);
  const safety = Math.max(0, Math.min(100, 100 - incPerRace * 5));
  const perf = 0.42 * results + 0.28 * pace + 0.30 * safety;
  const conf = Math.min(1, starts / 8);
  const rating = Math.round(perf * conf + 40 * (1 - conf));
  let t = LICENSE_TIERS.find((x) => rating >= x.min) || LICENSE_TIERS[LICENSE_TIERS.length - 1];
  while (t.name !== "Bronze" && starts < (LICENSE_GATE[t.name] || 0)) {
    t = LICENSE_TIERS[LICENSE_TIERS.indexOf(t) + 1];
  }
  return {
    tier: t.name, color: t.color, rating,
    pace: Math.round(pace), results: Math.round(results), safety: Math.round(safety),
    starts, incPerRace, wins, podiums, provisional: starts < 5,
  };
}
