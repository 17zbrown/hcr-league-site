/* Shared HCR racing-license computation, used by both the public site and the
   admin. Hybrid model, closer to real FIA/IMSA categorization:

   1. BASE CLASS (skill / pedigree) — set by, in priority order:
        a) a manual category assigned by the league (absolute), else
        b) the driver's iRating mapped to a band, else
        c) their in-league record (fallback until an iRating is on file).
   2. SAFETY NUDGE — a poor in-league incident record (over enough starts) can
      drop the class by one tier. Manual assignments are never nudged.
   3. FORM — league pace / results / safety are tracked alongside as a live
      "current form" read, not the class itself. */

export const LICENSE_TIERS = [
  { name: "Platinum", min: 88, color: "#DCE3EA" },
  { name: "Gold", min: 74, color: "#F5C542" },
  { name: "Silver", min: 58, color: "#AEB8C4" },
  { name: "Bronze", min: 0, color: "#CB8452" },
];
export const LICENSE_GATE = { Platinum: 8, Gold: 5, Silver: 3 };

/* sports-car iRating -> class band (tunable) */
export const IRATING_BANDS = [
  { min: 4000, name: "Platinum" },
  { min: 2500, name: "Gold" },
  { min: 1500, name: "Silver" },
  { min: 0, name: "Bronze" },
];
const SAFETY_DROP_INC = 10; // avg incidents/race above this (over >=3 starts) drops one tier

function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function lapToSeconds(t) {
  if (!t) return null;
  const m = String(t).match(/(?:(\d+):)?(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}
function iratingTier(ir) { return (IRATING_BANDS.find((b) => ir >= b.min) || IRATING_BANDS[IRATING_BANDS.length - 1]).name; }
function normalizeTier(s) { if (!s) return null; const m = LICENSE_TIERS.find((x) => x.name.toLowerCase() === String(s).toLowerCase()); return m ? m.name : null; }
function dropTier(name) { const i = LICENSE_TIERS.findIndex((x) => x.name === name); return i >= 0 && i < LICENSE_TIERS.length - 1 ? LICENSE_TIERS[i + 1].name : name; }
function tierColor(name) { return (LICENSE_TIERS.find((x) => x.name === name) || { color: "#6b7686" }).color; }

export function driverLicense(driver, events) {
  /* ---- league record / form ---- */
  const races = [];
  (events || []).forEach((ev) => {
    if (!ev.results || !ev.results.length) return;
    const r = ev.results.find((x) => String(x.num) === String(driver.num) && x.cls === driver.cls) ||
      (slug(driver.name).length > 3 ? ev.results.find((x) => slug(x.drivers).includes(slug(driver.name))) : null);
    if (r) races.push({ ev, r });
  });
  const starts = races.length;
  let pace = null, results = null, safety = null, rating = null, incPerRace = null, leagueTier = null;
  if (starts) {
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
    incPerRace = incTotal / starts;
    const posScore = (p) => p == null ? 55 : Math.max(0, Math.min(100, 104 - p * 11));
    results = Math.round(Math.min(100, posScore(avgFinish) + wins * 4 + podiums * 2));
    pace = Math.round(Math.min(100, posScore(avgGrid) + poles * 4 + fastLaps * 3));
    safety = Math.round(Math.max(0, Math.min(100, 100 - incPerRace * 5)));
    const perf = 0.42 * results + 0.28 * pace + 0.30 * safety;
    const conf = Math.min(1, starts / 8);
    rating = Math.round(perf * conf + 40 * (1 - conf));
    let lt = LICENSE_TIERS.find((x) => rating >= x.min) || LICENSE_TIERS[LICENSE_TIERS.length - 1];
    while (lt.name !== "Bronze" && starts < (LICENSE_GATE[lt.name] || 0)) lt = LICENSE_TIERS[LICENSE_TIERS.indexOf(lt) + 1];
    leagueTier = lt.name;
  }

  /* ---- base class (skill / pedigree) ---- */
  const override = normalizeTier(driver.licenseOverride);
  const ir = Number(driver.irating) || 0;
  let baseTier, source;
  if (override) { baseTier = override; source = "manual"; }
  else if (ir > 0) { baseTier = iratingTier(ir); source = "irating"; }
  else if (leagueTier) { baseTier = leagueTier; source = "league"; }
  else { baseTier = "Unranked"; source = "none"; }

  /* ---- safety nudge ---- */
  let tier = baseTier, nudged = false;
  if (source !== "manual" && baseTier !== "Unranked" && starts >= 3 && incPerRace != null && incPerRace > SAFETY_DROP_INC) {
    const dropped = dropTier(baseTier);
    if (dropped !== baseTier) { tier = dropped; nudged = true; }
  }

  return {
    tier, color: tier === "Unranked" ? "#6b7686" : tierColor(tier),
    source, nudged, baseTier,
    iRating: ir || null, override: override || null,
    rating, pace, results, safety, incPerRace,
    starts, provisional: source === "league" && starts < 5,
  };
}
