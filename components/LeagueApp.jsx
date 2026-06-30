"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Flag, Clock, CloudRain, Cloud, Sun, CloudSun, Wind, Droplets, Thermometer,
  Trophy, Calendar, Gauge, ChevronRight, X, Lock, Settings, Plus, Trash2,
  Save, Download, Upload, RotateCcw, MapPin, Users, Timer, Moon, Radio,
  ArrowLeft, CheckCircle2, CircleDot, Eye, FileText, Loader2, AlertTriangle, Search, Menu,
} from "lucide-react";

/* ============================================================
   APEX ENDURANCE SERIES — League Hub + Admin
   Single-file React app. Public front end + PIN-gated backend.
   Data persists to Claude's shared artifact storage (window.storage).
   ============================================================ */

const STORE_KEY = "apex:league:v9";
const CARS = {
  GTP: ["Acura ARX-06", "BMW M Hybrid V8", "Cadillac V-Series.R", "Ferrari 499P", "Porsche 963"],
  LMP2: ["Dallara P217"],
  GTD: ["Acura NSX GT3 EVO 22", "Aston Martin Vantage GT3 EVO", "BMW M4 GT3 EVO", "Chevrolet Corvette Z06 GT3.R", "Ferrari 296 GT3 EVO", "Ford Mustang GT3", "Lamborghini Huracán GT3 EVO", "McLaren 720S GT3 EVO", "Mercedes-AMG GT3 EVO", "Porsche 911 GT3 R (992)"],
};

/* Distinct high-contrast palette for chart lines (so same-class drivers don't share a color) */
const LINE_COLORS = ["#37C2F0", "#FFB627", "#FF6B6B", "#5BD6A0", "#C792EA", "#F5EE30", "#7AA2FF", "#FF8FCF", "#8AE234", "#FF9E64"];
const LOGO = "data:image/png;base64,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";

/* ---------------------------- Sample seed data ---------------------------- */
const SAMPLE = {
  league: {
    name: "HCR League",
    season: "Season 4",
    tagline: "iRacing multi-class endurance championship",
    timezone: "ET",
    adminPin: "2406",
    pointsTable: [35, 32, 30, 28, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11],
    links: {
      discord: "https://discord.gg/your-league",
      broadcast: "https://twitch.tv/your-league",
      rulebook: "https://example.com/rulebook",
    },
  },
  classes: [
    { id: "GTP", name: "GTP", color: "#FFFFFF" },
    { id: "LMP2", name: "LMP2", color: "#4F8DF0" },
    { id: "GTD", name: "GTD", color: "#4ADE80" },
  ],
  teams: [
    { id: "crimson", name: "Crimson Line Motorsport" },
    { id: "vortex", name: "Vortex Motorsport" },
    { id: "stratus", name: "Stratus Competition" },
    { id: "midnight", name: "Midnight Oil Racing" },
    { id: "redline", name: "Redline Collective" },
    { id: "pace", name: "Pace Theory Racing" },
    { id: "hairpin", name: "Hairpin Heroes" },
    { id: "apex", name: "Apex Predators Racing" },
  ],
  drivers: [
    { id: "d1", num: 7, name: "Lars Vandenberg", teamId: "vortex", cls: "GTP", country: "🇳🇱", car: "Porsche 963", pointsByRound: [35, 30, 33] },
    { id: "d2", num: 23, name: "Mateo Rossi", teamId: "crimson", cls: "GTP", country: "🇮🇹", car: "Cadillac V-Series.R", pointsByRound: [30, 35, 28] },
    { id: "d3", num: 5, name: "Kai Nakamura", teamId: "stratus", cls: "GTP", country: "🇯🇵", car: "Acura ARX-06", pointsByRound: [26, 28, 30] },
    { id: "d4", num: 91, name: "Oliver Frost", teamId: "redline", cls: "GTP", country: "🇬🇧", car: "BMW M Hybrid V8", pointsByRound: [28, 24, 26] },
    { id: "d5", num: 44, name: "Henrik Sørensen", teamId: "midnight", cls: "GTP", country: "🇩🇰", car: "Porsche 963", pointsByRound: [24, 26, 22] },
    { id: "d6", num: 12, name: "Lucas Moreau", teamId: "pace", cls: "GTP", country: "🇫🇷", car: "Ferrari 499P", pointsByRound: [22, 20, 24] },
    { id: "d7", num: 88, name: "Diego Castro", teamId: "apex", cls: "GTP", country: "🇪🇸", car: "Cadillac V-Series.R", pointsByRound: [20, 22, 20] },
    { id: "d8", num: 17, name: "Sofia Marchetti", teamId: "crimson", cls: "GTD", country: "🇮🇹", car: "Ferrari 296 GT3 EVO", pointsByRound: [33, 35, 33] },
    { id: "d9", num: 33, name: "Emil Bauer", teamId: "hairpin", cls: "GTD", country: "🇩🇪", car: "Porsche 911 GT3 R (992)", pointsByRound: [35, 33, 30] },
    { id: "d10", num: 9, name: "Ryan Walsh", teamId: "vortex", cls: "GTD", country: "🇺🇸", car: "BMW M4 GT3 EVO", pointsByRound: [30, 28, 35] },
    { id: "d11", num: 61, name: "Tomáš Novák", teamId: "stratus", cls: "GTD", country: "🇨🇿", car: "Lamborghini Huracán GT3 EVO", pointsByRound: [28, 30, 28] },
    { id: "d12", num: 4, name: "Anders Lund", teamId: "midnight", cls: "GTD", country: "🇸🇪", car: "Mercedes-AMG GT3 EVO", pointsByRound: [26, 24, 26] },
    { id: "d13", num: 50, name: "Marco Silva", teamId: "pace", cls: "GTD", country: "🇵🇹", car: "Chevrolet Corvette Z06 GT3.R", pointsByRound: [24, 26, 22] },
    { id: "d14", num: 2, name: "Grace Tan", teamId: "redline", cls: "GTD", country: "🇸🇬", car: "Aston Martin Vantage GT3 EVO", pointsByRound: [22, 20, 24] },
    { id: "d15", num: 21, name: "Felix Brandt", teamId: "vortex", cls: "LMP2", country: "🇩🇪", car: "Dallara P217", pointsByRound: [33, 30, 35] },
    { id: "d16", num: 38, name: "Noah Sullivan", teamId: "crimson", cls: "LMP2", country: "🇮🇪", car: "Dallara P217", pointsByRound: [35, 33, 30] },
    { id: "d17", num: 66, name: "Yuki Tanaka", teamId: "stratus", cls: "LMP2", country: "🇯🇵", car: "Dallara P217", pointsByRound: [30, 35, 33] },
    { id: "d18", num: 14, name: "Pablo Ortiz", teamId: "pace", cls: "LMP2", country: "🇲🇽", car: "Dallara P217", pointsByRound: [28, 28, 28] },
  ],
  events: [
    {
      id: "r1", round: 1, track: "Daytona International Speedway", location: "Daytona Beach, FL",
      durationH: 6, date: "2026-03-14T13:00:00", status: "complete",
      simStartHour: 13.5, timeMult: 1, entries: 38, minDrivers: 2, maxDrivers: 4,
      sessions: [
        { type: "Practice", start: "2026-03-14T11:30:00", durMin: 60 },
        { type: "Qualifying", start: "2026-03-14T12:40:00", durMin: 15 },
        { type: "Race", start: "2026-03-14T13:00:00", durMin: 360 },
      ],
      weather: [
        { atHour: 0, air: 75, sky: "Clear", precip: 0, wind: 7, humidity: 55 },
        { atHour: 3, air: 79, sky: "Partly Cloudy", precip: 5, wind: 9, humidity: 50 },
        { atHour: 6, air: 72, sky: "Clear", precip: 0, wind: 6, humidity: 60 },
      ],
      notes: "Season opener. High-banking superspeedway draft — class separation on entry to the bus stop is critical. Mandatory minimum 2 drivers; max 4-hour single-driver stint.",
      winners: { GTP: "#7 Vortex Motorsport", LMP2: "#38 Crimson Line Motorsport", GTD: "#33 Hairpin Heroes" },
      results: [
        { pos: 1, clsPos: 1, cls: "GTP", num: "7", drivers: "Lars Vandenberg", nat: "🇳🇱", car: "Porsche 963", grid: 1, inc: 2, laps: 241, time: "6:00:14.301", gap: "—", best: "1:35.433", status: "Running", points: 35, lapChart: [
          { lap: 1, time: "1:41.810", sec: 101.81 }, { lap: 2, time: "1:35.900", sec: 95.9 }, { lap: 3, time: "1:36.112", sec: 96.112 }, { lap: 4, time: "1:35.861", sec: 95.861 }, { lap: 5, time: "1:35.712", sec: 95.712 }, { lap: 6, time: "1:36.047", sec: 96.047 }, { lap: 7, time: "1:35.858", sec: 95.858 }, { lap: 8, time: "1:39.002", sec: 99.002 }, { lap: 9, time: "1:37.776", sec: 97.776 }, { lap: 10, time: "1:38.274", sec: 98.274 }, { lap: 11, time: "1:35.787", sec: 95.787 }, { lap: 12, time: "1:35.707", sec: 95.707 }, { lap: 13, time: "1:35.673", sec: 95.673 }, { lap: 14, time: "1:35.443", sec: 95.443 }, { lap: 15, time: "1:35.563", sec: 95.563 }, { lap: 16, time: "2:35.591", sec: 155.591 }, { lap: 17, time: "1:43.318", sec: 103.318 }, { lap: 18, time: "1:36.308", sec: 96.308 }, { lap: 19, time: "1:36.090", sec: 96.09 }, { lap: 20, time: "1:35.862", sec: 95.862 } ] },
        { pos: 2, clsPos: 2, cls: "GTP", num: "23", drivers: "Mateo Rossi", nat: "🇮🇹", car: "Cadillac V-Series.R", grid: 3, inc: 5, laps: 241, time: "6:00:46.166", gap: "0:32.865", best: "1:35.612", status: "Running", points: 32, lapChart: [
          { lap: 1, time: "1:42.040", sec: 102.04 }, { lap: 2, time: "1:36.518", sec: 96.518 }, { lap: 3, time: "1:36.251", sec: 96.251 }, { lap: 4, time: "1:36.293", sec: 96.293 }, { lap: 5, time: "1:35.880", sec: 95.88 }, { lap: 6, time: "1:36.204", sec: 96.204 }, { lap: 7, time: "1:36.138", sec: 96.138 }, { lap: 8, time: "1:36.474", sec: 96.474 }, { lap: 9, time: "1:36.654", sec: 96.654 }, { lap: 10, time: "1:36.738", sec: 96.738 }, { lap: 11, time: "1:36.089", sec: 96.089 }, { lap: 12, time: "1:35.945", sec: 95.945 }, { lap: 13, time: "1:35.884", sec: 95.884 }, { lap: 14, time: "1:35.766", sec: 95.766 }, { lap: 15, time: "1:35.621", sec: 95.621 }, { lap: 16, time: "2:41.983", sec: 161.983 }, { lap: 17, time: "1:46.215", sec: 106.215 }, { lap: 18, time: "1:35.805", sec: 95.805 }, { lap: 19, time: "1:35.612", sec: 95.612 }, { lap: 20, time: "1:35.933", sec: 95.933 } ] },
        { pos: 3, clsPos: 3, cls: "GTP", num: "5", drivers: "Kai Nakamura", nat: "🇯🇵", car: "Acura ARX-06", grid: 5, inc: 4, laps: 240, time: "—", gap: "1 LAP", best: "1:35.864", status: "Running", points: 30, lapChart: [] },
        { pos: 4, clsPos: 1, cls: "LMP2", num: "38", drivers: "Noah Sullivan", nat: "🇮🇪", car: "Dallara P217", grid: 6, inc: 3, laps: 236, time: "—", gap: "5 LAPS", best: "1:38.221", status: "Running", points: 35, lapChart: [] },
        { pos: 5, clsPos: 2, cls: "LMP2", num: "21", drivers: "Felix Brandt", nat: "🇩🇪", car: "Dallara P217", grid: 8, inc: 7, laps: 235, time: "—", gap: "6 LAPS", best: "1:38.540", status: "Running", points: 32, lapChart: [] },
        { pos: 6, clsPos: 1, cls: "GTD", num: "33", drivers: "Emil Bauer", nat: "🇩🇪", car: "Porsche 911 GT3 R (992)", grid: 10, inc: 6, laps: 228, time: "—", gap: "13 LAPS", best: "1:44.612", status: "Running", points: 35, lapChart: [] },
        { pos: 7, clsPos: 2, cls: "GTD", num: "17", drivers: "Sofia Marchetti", nat: "🇮🇹", car: "Ferrari 296 GT3 EVO", grid: 12, inc: 8, laps: 228, time: "—", gap: "13 LAPS", best: "1:44.788", status: "Running", points: 32, lapChart: [] },
        { pos: 8, clsPos: 3, cls: "GTD", num: "9", drivers: "Ryan Walsh", nat: "🇺🇸", car: "BMW M4 GT3 EVO", grid: 9, inc: 11, laps: 214, time: "—", gap: "27 LAPS", best: "1:45.108", status: "DNF", points: 30, lapChart: [] },
      ],
    },
    {
      id: "r2", round: 2, track: "Sebring International Raceway", location: "Sebring, FL",
      durationH: 8, date: "2026-04-18T11:00:00", status: "complete",
      simStartHour: 10.7, timeMult: 1, entries: 41, minDrivers: 2, maxDrivers: 4,
      sessions: [
        { type: "Practice", start: "2026-04-18T09:30:00", durMin: 60 },
        { type: "Qualifying", start: "2026-04-18T10:40:00", durMin: 15 },
        { type: "Race", start: "2026-04-18T11:00:00", durMin: 480 },
      ],
      weather: [
        { atHour: 0, air: 82, sky: "Clear", precip: 0, wind: 6, humidity: 48 },
        { atHour: 4, air: 88, sky: "Partly Cloudy", precip: 10, wind: 7, humidity: 45 },
        { atHour: 8, air: 77, sky: "Cloudy", precip: 20, wind: 9, humidity: 58 },
      ],
      notes: "Bumpy concrete-and-asphalt classic. Tire deg is the story — manage the front-left through Sunset Bend. Day-into-dusk transition near the finish.",
      winners: { GTP: "#23 Crimson Line Motorsport", LMP2: "#66 Stratus Competition", GTD: "#33 Hairpin Heroes" },
    },
    {
      id: "r3", round: 3, track: "Watkins Glen International", location: "Watkins Glen, NY",
      durationH: 6, date: "2026-05-16T12:00:00", status: "complete",
      simStartHour: 12, timeMult: 1, entries: 40, minDrivers: 2, maxDrivers: 3,
      sessions: [
        { type: "Practice", start: "2026-05-16T10:30:00", durMin: 60 },
        { type: "Qualifying", start: "2026-05-16T11:40:00", durMin: 15 },
        { type: "Race", start: "2026-05-16T12:00:00", durMin: 360 },
      ],
      weather: [
        { atHour: 0, air: 66, sky: "Partly Cloudy", precip: 15, wind: 11, humidity: 62 },
        { atHour: 3, air: 70, sky: "Cloudy", precip: 35, wind: 14, humidity: 70 },
        { atHour: 6, air: 63, sky: "Light Rain", precip: 65, wind: 15, humidity: 82 },
      ],
      notes: "Fast, flowing, commitment-heavy. Watch the radar — a damp window in the final two hours rewards a brave crossover call.",
      winners: { GTP: "#7 Vortex Motorsport", LMP2: "#38 Crimson Line Motorsport", GTD: "#9 Vortex Motorsport" },
    },
    {
      id: "r4", round: 4, track: "Nürburgring Nordschleife", location: "Nürburg, Germany",
      durationH: 12, date: "2026-07-11T08:00:00", status: "next",
      simStartHour: 15, timeMult: 1, entries: 44, minDrivers: 3, maxDrivers: 5,
      sessions: [
        { type: "Practice", start: "2026-07-11T06:30:00", durMin: 60 },
        { type: "Qualifying", start: "2026-07-11T07:40:00", durMin: 20 },
        { type: "Race", start: "2026-07-11T08:00:00", durMin: 720 },
      ],
      weather: [
        { atHour: 0, air: 63, sky: "Partly Cloudy", precip: 20, wind: 10, humidity: 65 },
        { atHour: 4, air: 57, sky: "Cloudy", precip: 45, wind: 12, humidity: 78 },
        { atHour: 8, air: 52, sky: "Light Rain", precip: 60, wind: 14, humidity: 88 },
        { atHour: 12, air: 48, sky: "Cloudy", precip: 30, wind: 11, humidity: 84 },
      ],
      notes: "The big one before the finale. 15+ miles of combined GP + Nordschleife, into the night. Minimum 3 drivers. Fog and shifting grip in the Eifel — headlights and patience win this.",
      winners: null,
    },
    {
      id: "r5", round: 5, track: "Circuit de Spa-Francorchamps", location: "Stavelot, Belgium",
      durationH: 10, date: "2026-08-15T10:00:00", status: "upcoming",
      simStartHour: 18, timeMult: 1, entries: 42, minDrivers: 3, maxDrivers: 4,
      sessions: [
        { type: "Practice", start: "2026-08-15T08:30:00", durMin: 60 },
        { type: "Qualifying", start: "2026-08-15T09:40:00", durMin: 20 },
        { type: "Race", start: "2026-08-15T10:00:00", durMin: 600 },
      ],
      weather: [
        { atHour: 0, air: 64, sky: "Partly Cloudy", precip: 25, wind: 9, humidity: 68 },
        { atHour: 5, air: 55, sky: "Light Rain", precip: 55, wind: 11, humidity: 85 },
        { atHour: 10, air: 50, sky: "Cloudy", precip: 35, wind: 10, humidity: 80 },
      ],
      notes: "Evening start straight into Ardennes darkness. Spa makes its own weather — it can be dry at La Source and soaked through Eau Rouge in the same lap.",
      winners: null,
    },
    {
      id: "r6", round: 6, track: "Circuit de la Sarthe", location: "Le Mans, France",
      durationH: 24, date: "2026-09-19T09:00:00", status: "upcoming", pointsMult: 2,
      simStartHour: 15, timeMult: 1, entries: 50, minDrivers: 3, maxDrivers: 6,
      sessions: [
        { type: "Practice", start: "2026-09-19T07:00:00", durMin: 90 },
        { type: "Qualifying", start: "2026-09-19T08:40:00", durMin: 20 },
        { type: "Race", start: "2026-09-19T09:00:00", durMin: 1440 },
      ],
      weather: [
        { atHour: 0, air: 70, sky: "Clear", precip: 5, wind: 6, humidity: 55 },
        { atHour: 6, air: 61, sky: "Clear", precip: 5, wind: 5, humidity: 68 },
        { atHour: 12, air: 52, sky: "Partly Cloudy", precip: 20, wind: 6, humidity: 86 },
        { atHour: 18, air: 57, sky: "Cloudy", precip: 30, wind: 7, humidity: 78 },
        { atHour: 24, air: 72, sky: "Clear", precip: 5, wind: 7, humidity: 52 },
      ],
      notes: "Season finale and double points. A full day-night-day cycle down the Mulsanne. Minimum 3 drivers, six permitted. The championship is decided here.",
      winners: null,
    },
  ],
};

/* ------------------------------- Storage I/O ------------------------------ */
function hasStorage() {
  return typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
}
async function loadLeague() {
  if (hasStorage()) {
    try {
      const res = await window.storage.get(STORE_KEY, true);
      if (res && res.value) return { data: JSON.parse(res.value), persisted: true };
    } catch (e) { /* key not found -> seed below */ }
    try { await window.storage.set(STORE_KEY, JSON.stringify(SAMPLE), true); } catch (e) {}
    return { data: clone(SAMPLE), persisted: true };
  }
  return { data: clone(SAMPLE), persisted: false };
}
async function saveLeague(data) {
  if (!hasStorage()) return false;
  try { await window.storage.set(STORE_KEY, JSON.stringify(data), true); return true; } catch (e) { return false; }
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/* --------------------------------- Utils ---------------------------------- */
const ET_TZ = "America/New_York";
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET_TZ });
  } catch { return iso; }
}
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET_TZ });
  } catch { return iso; }
}
function fmtFullDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: ET_TZ });
  } catch { return iso; }
}
function simClock(hour) {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
/* Points a driver scored in one event: from that event's results (matched by car number),
   falling back to a stored per-round value only when the driver isn't in the results. */
function roundPoints(driver, ev) {
  if (ev && ev.results && ev.results.length) {
    const ms = ev.results.filter((r) => String(r.num) === String(driver.num) && r.cls === driver.cls);
    if (ms.length) return ms.reduce((a, r) => a + (Number(r.points) || 0) + (Number(r.adjust) || 0), 0);
  }
  return Number((driver.pointsByRound || [])[(ev.round || 1) - 1] || 0);
}
function driverPoints(d, events) { return (events || []).reduce((a, ev) => a + roundPoints(d, ev), 0); }

/* sky color keyframes -> muted, dark-theme-friendly */
const SKY = [
  { h: 0, c: [12, 16, 34] }, { h: 4.5, c: [20, 24, 50] }, { h: 6, c: [86, 64, 92] },
  { h: 7.5, c: [120, 96, 86] }, { h: 9, c: [70, 110, 150] }, { h: 12, c: [86, 142, 184] },
  { h: 15.5, c: [88, 132, 172] }, { h: 17.5, c: [196, 104, 58] }, { h: 19, c: [120, 64, 78] },
  { h: 20.5, c: [40, 38, 78] }, { h: 22, c: [20, 24, 54] }, { h: 24, c: [12, 16, 34] },
];
function skyColor(hour) {
  const h = ((hour % 24) + 24) % 24;
  let a = SKY[0], b = SKY[SKY.length - 1];
  for (let i = 0; i < SKY.length - 1; i++) {
    if (h >= SKY[i].h && h <= SKY[i + 1].h) { a = SKY[i]; b = SKY[i + 1]; break; }
  }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const mix = (i) => Math.round(a.c[i] + (b.c[i] - a.c[i]) * t);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}
function durMins(ev) { return ev?.durationMin != null ? ev.durationMin : Math.round((ev?.durationH || 0) * 60); }
function fmtDur(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return "0 min";
  if (m % 60 === 0) return (m / 60) + "h";
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + "h " + (m % 60) + "m";
}
function dayNightGradient(simStart, durationH, mult = 1) {
  const stops = [];
  const steps = Math.min(60, Math.max(12, Math.round(durationH * 2)));
  for (let i = 0; i <= steps; i++) {
    const elapsed = (i / steps) * durationH;
    const simHour = simStart + elapsed * mult;
    const pct = (i / steps) * 100;
    stops.push(`${skyColor(simHour)} ${pct.toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
function sunEvents(simStart, durationH, mult = 1) {
  const events = [];
  const SR = 6.2, SS = 18.4; // approx sunrise / sunset sim hours
  const N = Math.round(durationH * mult) + 2;
  for (let k = -1; k <= N; k++) {
    const targets = [{ h: SR + 24 * k, label: "Sunrise" }, { h: SS + 24 * k, label: "Sunset" }];
    for (const tg of targets) {
      const elapsed = (tg.h - simStart) / mult;
      if (elapsed > 0.2 && elapsed < durationH - 0.2) {
        events.push({ pct: (elapsed / durationH) * 100, label: tg.label });
      }
    }
  }
  return events;
}

const SKY_ICON = {
  "Clear": Sun, "Partly Cloudy": CloudSun, "Cloudy": Cloud, "Light Rain": CloudRain, "Rain": CloudRain,
};

/* ============================== Shared UI bits ============================= */
function Chip({ children, color, dim }) {
  return (
    <span className="aes-chip" style={{ color: color || "var(--mist)", borderColor: dim ? "var(--line)" : (color || "var(--line)"), background: color ? color + "1A" : "transparent" }}>
      {children}
    </span>
  );
}
function ClassDot({ cls, classes }) {
  const c = (classes || []).find((x) => x.id === cls);
  return <span className="aes-cls" style={{ color: c ? c.color : "var(--mist)", borderColor: c ? c.color : "var(--line)" }}>{cls}</span>;
}
function StatusChip({ status }) {
  if (status === "complete") return <Chip color="#5BD6A0" dim><CheckCircle2 size={11} /> Final</Chip>;
  if (status === "next") return <Chip color="var(--signal)"><CircleDot size={11} /> Next Up</Chip>;
  return <Chip dim>Scheduled</Chip>;
}

/* =============================== Day/Night bar ============================= */
function DayNightBar({ ev, compact }) {
  const grad = dayNightGradient(ev.simStartHour, ev.durationH, ev.timeMult);
  const suns = sunEvents(ev.simStartHour, ev.durationH, ev.timeMult);
  const endHour = ev.simStartHour + ev.durationH * (ev.timeMult || 1);
  const hourTicks = [];
  if (!compact) {
    const tickEvery = ev.durationH <= 8 ? 1 : ev.durationH <= 14 ? 2 : 3;
    for (let e = 0; e <= ev.durationH + 0.001; e += tickEvery) {
      hourTicks.push({ pct: (e / ev.durationH) * 100, sim: ev.simStartHour + e * (ev.timeMult || 1) });
    }
  }
  return (
    <div className={"aes-dn" + (compact ? " compact" : "")}>
      <div className="aes-dn-bar" style={{ background: grad }} aria-hidden="true">
        {suns.map((s, i) => (
          <div key={i} className="aes-dn-sun" style={{ left: s.pct + "%" }} title={s.label}>
            {s.label === "Sunrise" ? <Sun size={12} /> : <Moon size={12} />}
          </div>
        ))}
      </div>
      <div className="aes-dn-ends">
        <span className="mono">{simClock(ev.simStartHour)} <em>start</em></span>
        <span className="aes-dn-mid">{fmtDur(durMins(ev))}</span>
        <span className="mono"><em>finish</em> {simClock(endHour)}</span>
      </div>
      {!compact && (
        <div className="aes-dn-ticks">
          {hourTicks.map((t, i) => (
            <span key={i} className="aes-dn-tick mono" style={{ left: t.pct + "%" }}>{simClock(t.sim)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== Weather strip ============================= */
function WeatherCell({ w }) {
  const Icon = SKY_ICON[w.sky] || Cloud;
  const wet = w.precip >= 40;
  return (
    <div className="aes-wx">
      <div className="aes-wx-top">
        <Icon size={20} style={{ color: wet ? "var(--accent2)" : "var(--amber)" }} />
        <span className="aes-wx-hr mono">+{w.atHour}h</span>
      </div>
      <div className="aes-wx-sky">{w.sky}</div>
      <div className="aes-wx-rows">
        <span><Thermometer size={12} /> {w.air}°F air</span>
        <span><Droplets size={12} /> {w.precip}% rain</span>
        <span><Wind size={12} /> {w.wind} mph</span>
      </div>
    </div>
  );
}

/* ================================ Countdown =============================== */
function useCountdown(targetIso) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, new Date(targetIso).getTime() - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { d, h, m, s, done: diff === 0 };
}

/* ================================ Dashboard =============================== */
function broadcastEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      let id = "";
      if (host.includes("youtu.be")) id = u.pathname.slice(1);
      else if (u.searchParams.get("v")) id = u.searchParams.get("v");
      else if (u.pathname.includes("/live/")) id = u.pathname.split("/live/")[1];
      else if (u.pathname.includes("/embed/")) id = u.pathname.split("/embed/")[1];
      id = (id || "").split("/")[0];
      if (id) return { platform: "YouTube", src: "https://www.youtube.com/embed/" + id };
    }
    if (host.includes("twitch.tv")) {
      const ch = u.pathname.split("/").filter(Boolean)[0];
      if (ch) {
        const parent = (typeof window !== "undefined" && window.location && window.location.hostname) || "localhost";
        return { platform: "Twitch", src: "https://player.twitch.tv/?channel=" + ch + "&parent=" + parent + "&muted=true" };
      }
    }
  } catch (e) { /* not a URL */ }
  return null;
}

function BroadcastCard({ url }) {
  if (!url) return null;
  const e = broadcastEmbed(url);
  return (
    <section className="aes-card">
      <div className="aes-card-head">
        <h2><Radio size={16} /> Live broadcast</h2>
        <a className="aes-link" href={url} target="_blank" rel="noreferrer">Open {e ? e.platform : "stream"} <ChevronRight size={13} /></a>
      </div>
      {e ? (
        <div className="aes-cast-frame">
          <iframe src={e.src} title="Broadcast" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <a className="aes-cast-link" href={url} target="_blank" rel="noreferrer"><Radio size={18} /> Watch the broadcast</a>
      )}
    </section>
  );
}

function Dashboard({ data, openEvent, go }) {
  const next = data.events.find((e) => e.status === "next") || data.events.find((e) => e.status === "upcoming") || data.events[0];
  const raceSession = next?.sessions?.find((s) => s.type === "Race");
  const cd = useCountdown(raceSession?.start || next?.date || new Date().toISOString());
  const completed = data.events.filter((e) => e.status === "complete").length;

  const leaders = useMemo(() => {
    const byClass = {};
    data.classes.forEach((c) => {
      byClass[c.id] = data.drivers.filter((d) => d.cls === c.id)
        .map((d) => ({ ...d, pts: driverPoints(d, data.events) }))
        .sort((a, b) => b.pts - a.pts).slice(0, 3);
    });
    return byClass;
  }, [data]);

  const lastDone = [...data.events].filter((e) => e.status === "complete").pop();

  return (
    <div className="aes-page">
      {/* Hero — next race */}
      <section className="aes-hero">
        <div className="aes-hero-tag">
          <Flag size={13} /> Next Round · {next.location}
        </div>
        <div className="aes-hero-grid">
          <div className="aes-hero-main">
            <div className="aes-hero-round mono">R{next.round}</div>
            <h1 className="aes-hero-track">{next.track}</h1>
            <div className="aes-hero-sub">
              <span><Timer size={14} /> {fmtDur(durMins(next))}</span>
              <span><Calendar size={14} /> {fmtFullDate(next.date)}</span>
              <span><Clock size={14} /> {fmtTime(raceSession?.start)} {data.league.timezone}</span>
            </div>
            <button className="aes-btn primary" onClick={() => openEvent(next.id)}>
              Event details <ChevronRight size={15} />
            </button>
          </div>
          <div className="aes-countdown">
            <div className="aes-cd-label">Lights out in</div>
            <div className="aes-cd-row">
              {[["DAYS", cd.d], ["HRS", cd.h], ["MIN", cd.m], ["SEC", cd.s]].map(([l, v]) => (
                <div className="aes-cd-cell" key={l}>
                  <div className="aes-cd-num mono">{String(v).padStart(2, "0")}</div>
                  <div className="aes-cd-unit">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="aes-hero-dn">
          <div className="aes-section-label"><Sun size={12} /> In-sim day / night cycle</div>
          <DayNightBar ev={next} />
        </div>
      </section>

      <BroadcastCard url={data.league.links && data.league.links.broadcast} />

      {/* Weather preview */}
      <section className="aes-card">
        <div className="aes-card-head">
          <h2><CloudSun size={16} /> Forecast — {next.track}</h2>
          <button className="aes-link" onClick={() => openEvent(next.id)}>Full event <ChevronRight size={13} /></button>
        </div>
        <div className="aes-wx-strip">
          {next.weather.map((w, i) => <WeatherCell key={i} w={w} />)}
        </div>
      </section>

      {/* Championship leaders */}
      <section className="aes-card">
        <div className="aes-card-head">
          <h2><Trophy size={16} /> Championship leaders</h2>
          <button className="aes-link" onClick={() => go("standings")}>All standings <ChevronRight size={13} /></button>
        </div>
        <div className="aes-leader-grid">
          {data.classes.map((c) => (
            <div key={c.id} className="aes-leader-col">
              <div className="aes-leader-cls" style={{ color: c.color, borderColor: c.color }}>{c.name}</div>
              {(leaders[c.id] || []).map((d, i) => {
                const team = data.teams.find((t) => t.id === d.teamId);
                return (
                  <div key={d.id} className="aes-leader-row">
                    <span className="aes-pos mono">{i + 1}</span>
                    <span className="aes-flag">{d.country}</span>
                    <span className="aes-leader-name">{d.name}<em>{team?.name}</em></span>
                    <span className="aes-leader-pts mono">{d.pts}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Season progress + last result */}
      <section className="aes-split">
        <div className="aes-card">
          <div className="aes-card-head"><h2><Calendar size={16} /> Season progress</h2></div>
          <div className="aes-progress">
            <div className="aes-progress-bar"><div className="aes-progress-fill" style={{ width: (completed / data.events.length) * 100 + "%" }} /></div>
            <div className="aes-progress-meta mono">{completed} / {data.events.length} rounds complete</div>
          </div>
          <div className="aes-mini-sched">
            {data.events.map((e) => (
              <button key={e.id} className={"aes-mini-round " + e.status} onClick={() => openEvent(e.id)}>
                <span className="mono">R{e.round}</span>
                <span>{e.track.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>
        {lastDone && (
          <div className="aes-card">
            <div className="aes-card-head"><h2><Flag size={16} /> Last result · {lastDone.track.split(" ")[0]}</h2></div>
            <div className="aes-result">
              {data.classes.map((c) => (
                <div key={c.id} className="aes-result-row">
                  <span className="aes-cls-pill" style={{ color: c.color, borderColor: c.color }}>{c.name} winner</span>
                  <span className="aes-result-win">{lastDone.winners?.[c.id] || "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ================================ Schedule ================================ */
function Schedule({ data, openEvent }) {
  return (
    <div className="aes-page">
      <div className="aes-page-head">
        <h1>Season Schedule</h1>
        <p>{data.league.season} · all times {data.league.timezone}</p>
      </div>
      <div className="aes-timeline">
        {data.events.map((e) => {
          const race = e.sessions.find((s) => s.type === "Race");
          return (
            <button key={e.id} className={"aes-tl-row " + e.status} onClick={() => openEvent(e.id)}>
              <div className="aes-tl-round">
                <span className="mono">R{e.round}</span>
                <StatusChip status={e.status} />
              </div>
              <div className="aes-tl-main">
                <div className="aes-tl-track">{e.track}</div>
                <div className="aes-tl-loc"><MapPin size={12} /> {e.location}</div>
              </div>
              <div className="aes-tl-meta">
                <span className="mono"><Timer size={13} /> {fmtDur(durMins(e))}</span>
                <span className="mono"><Calendar size={13} /> {fmtDate(e.date)}</span>
                <span className="mono"><Clock size={13} /> {fmtTime(race?.start)}</span>
              </div>
              <div className="aes-tl-dn"><DayNightBar ev={e} compact /></div>
              <ChevronRight size={18} className="aes-tl-arrow" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* =============================== Event detail ============================= */
function EventDetail({ data, ev, back, openDriver }) {
  const race = ev.sessions.find((s) => s.type === "Race");
  const cd = useCountdown(race?.start || ev.date);
  const upcoming = ev.status !== "complete";
  return (
    <div className="aes-page">
      <button className="aes-back" onClick={back}><ArrowLeft size={16} /> Schedule</button>
      <section className="aes-event-hero">
        <div className="aes-event-top">
          <span className="aes-hero-round mono">R{ev.round}</span>
          <StatusChip status={ev.status} />
        </div>
        <h1 className="aes-hero-track">{ev.track}</h1>
        <div className="aes-hero-sub">
          <span><MapPin size={14} /> {ev.location}</span>
          <span><Timer size={14} /> {fmtDur(durMins(ev))}</span>
          <span><Calendar size={14} /> {fmtFullDate(ev.date)}</span>
          <span><Users size={14} /> {ev.entries} entries</span>
        </div>
        {upcoming && (
          <div className="aes-event-cd mono">
            {cd.d}d : {String(cd.h).padStart(2, "0")}h : {String(cd.m).padStart(2, "0")}m : {String(cd.s).padStart(2, "0")}s
            <span> to green flag</span>
          </div>
        )}
      </section>

      <div className="aes-split">
        <section className="aes-card">
          <div className="aes-card-head"><h2><Clock size={16} /> Session schedule</h2></div>
          <div className="aes-sessions">
            {ev.sessions.map((s, i) => (
              <div key={i} className={"aes-session " + (s.type === "Race" ? "race" : "")}>
                <div className="aes-session-type">{s.type}</div>
                <div className="aes-session-time mono">
                  {fmtDate(s.start)} · {fmtTime(s.start)} {data.league.timezone}
                </div>
                <div className="aes-session-dur mono">{s.durMin >= 60 ? `${(s.durMin / 60).toFixed(s.durMin % 60 ? 1 : 0)}h` : `${s.durMin}m`}</div>
              </div>
            ))}
          </div>
          <div className="aes-format">
            <span><Users size={13} /> {ev.minDrivers}–{ev.maxDrivers} drivers per car</span>
          </div>
        </section>

        <section className="aes-card">
          <div className="aes-card-head"><h2><Sun size={16} /> In-sim time & track</h2></div>
          <DayNightBar ev={ev} />
          <div className="aes-format" style={{ marginTop: 14 }}>
            <span className="mono">Sim start {simClock(ev.simStartHour)}</span>
            <span className="mono">Time scale {ev.timeMult === 1 ? "real-time (1×)" : ev.timeMult + "×"}</span>
          </div>
        </section>
      </div>

      <section className="aes-card">
        <div className="aes-card-head"><h2><CloudSun size={16} /> Predicted weather</h2></div>
        <div className="aes-wx-strip">
          {ev.weather.map((w, i) => <WeatherCell key={i} w={w} />)}
        </div>
      </section>

      {ev.notes && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Radio size={16} /> Race control notes</h2></div>
          <p className="aes-notes">{ev.notes}</p>
        </section>
      )}

      {ev.winners && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Trophy size={16} /> Results</h2></div>
          <div className="aes-result">
            {data.classes.map((c) => (
              <div key={c.id} className="aes-result-row">
                <span className="aes-cls-pill" style={{ color: c.color, borderColor: c.color }}>{c.name} winner</span>
                <span className="aes-result-win">{ev.winners?.[c.id] || "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {ev.results && ev.results.length > 0 && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Flag size={16} /> Classified results</h2></div>
          {data.classes.map((c) => {
            const inCls = ev.results.filter((r) => r.cls === c.id).sort((a, b) => a.pos - b.pos);
            if (!inCls.length) return null;
            return (
              <div key={c.id} className="aes-cr-block">
                <div className="aes-cr-clshead"><span className="aes-cls-pill" style={{ color: c.color, borderColor: c.color }}>{c.name}</span></div>
                <div className="aes-rt-wrap">
                  <table className="aes-results-table">
                    <thead><tr><th>Pos</th><th>#</th><th>Driver</th><th>Car</th><th>Grid</th><th>Laps</th><th>Best</th><th>Gap</th><th>Inc</th><th>Status</th><th>Pts</th></tr></thead>
                    <tbody>
                      {inCls.map((r, i) => {
                        const match = data.drivers.find((d) => String(d.num) === String(r.num) && d.cls === r.cls);
                        return (
                          <tr key={i}>
                            <td className="aes-results-pos">{r.clsPos || i + 1}</td>
                            <td className="mono">{r.num}</td>
                            <td>{match
                              ? <button className="aes-link-driver" onClick={() => openDriver && openDriver(match.id)}>{r.drivers}</button>
                              : r.drivers}</td>
                            <td className="dim aes-rt-car">{r.car || "—"}</td>
                            <td className="mono dim">{r.grid !== "" && r.grid != null ? r.grid : "—"}</td>
                            <td className="mono dim">{r.laps !== "" && r.laps != null ? r.laps : "—"}</td>
                            <td className="mono dim">{r.best || "—"}</td>
                            <td className="mono dim">{r.gap || "—"}</td>
                            <td className="mono dim">{r.inc !== "" && r.inc != null ? r.inc : "—"}</td>
                            <td className="mono dim">{r.status || "—"}</td>
                            <td className="mono pts">{r.points != null ? (Number(r.points) + Number(r.adjust || 0)) : "—"}{r.adjust ? <span className="aes-pen" title="Stewards' adjustment">{Number(r.adjust) > 0 ? " +" : " "}{r.adjust}</span> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

/* ============================== Driver profile =========================== */
function DriverProfile({ data, driver, back, openEvent }) {
  const team = data.teams.find((t) => t.id === driver.teamId);
  const cls = data.classes.find((c) => c.id === driver.cls);

  const races = useMemo(() => {
    const out = [];
    data.events.forEach((ev) => {
      if (!ev.results || !ev.results.length) return;
      const r = ev.results.find((x) => String(x.num) === String(driver.num) && x.cls === driver.cls) ||
                (slug(driver.name).length > 3 ? ev.results.find((x) => slug(x.drivers).includes(slug(driver.name))) : null);
      if (r) out.push({ ev, r });
    });
    return out.sort((a, b) => a.ev.round - b.ev.round);
  }, [data, driver]);

  const totalPts = driverPoints(driver, data.events);
  const finishes = races.map((x) => x.r.clsPos).filter((n) => n != null && n !== "");
  const bestFinish = finishes.length ? Math.min(...finishes) : null;
  const incTotal = races.reduce((a, x) => a + (Number(x.r.inc) || 0), 0);
  let bestLap = "", bestLapSec = null;
  let wins = 0, podiums = 0, poles = 0, fastLaps = 0, lapsTotal = 0;
  races.forEach((x) => {
    const r = x.r, ev = x.ev;
    const s = lapToSeconds(r.best);
    if (s != null && (bestLapSec == null || s < bestLapSec)) { bestLapSec = s; bestLap = r.best; }
    if (r.clsPos === 1) wins++;
    if (r.clsPos && r.clsPos <= 3) podiums++;
    lapsTotal += Number(r.laps) || 0;
    const sameCls = (ev.results || []).filter((y) => y.cls === r.cls);
    const grids = sameCls.map((y) => Number(y.grid)).filter((n) => !isNaN(n) && n > 0);
    if (grids.length && Number(r.grid) === Math.min(...grids)) poles++;
    const secs = sameCls.map((y) => lapToSeconds(y.best)).filter((v) => v != null);
    if (s != null && secs.length && s === Math.min(...secs)) fastLaps++;
  });
  const avgFinish = finishes.length ? finishes.reduce((a, b) => a + b, 0) / finishes.length : null;

  const completed = data.events.filter((e) => e.status === "complete").sort((a, b) => a.round - b.round);
  let cum = 0;
  const progression = completed.map((e) => { cum += roundPoints(driver, e); return { round: "R" + e.round, pts: cum }; });

  const lapRaces = races.filter((x) => x.r.lapChart && x.r.lapChart.length);
  const [lapSel, setLapSel] = useState(lapRaces.length ? lapRaces[0].ev.id : null);
  const selRace = lapRaces.find((x) => x.ev.id === lapSel) || lapRaces[0];
  const lapData = selRace ? selRace.r.lapChart.map((l) => ({ lap: l.lap, sec: l.sec, time: l.time })) : [];
  const sortedSecs = lapData.map((d) => d.sec).sort((a, b) => a - b);
  const median = sortedSecs.length ? sortedSecs[Math.floor(sortedSecs.length / 2)] : 0;
  const yMax = median ? +(median * 1.25).toFixed(1) : "auto";

  return (
    <div className="aes-page">
      <button className="aes-back" onClick={back}><ArrowLeft size={15} /> Back</button>

      <div className="aes-prof-head">
        <div className="aes-prof-num mono">{driver.num}</div>
        <div className="aes-prof-id">
          <h1 className="aes-prof-name">{driver.country ? <span className="aes-flag">{driver.country}</span> : null} {driver.name}</h1>
          <div className="aes-prof-meta">
            {cls && <span className="aes-cls-pill" style={{ color: cls.color, borderColor: cls.color }}>{cls.name}</span>}
            {team && <span className="aes-prof-team">{team.name}</span>}
            {driver.car && <span className="aes-prof-car mono">{driver.car}</span>}
          </div>
        </div>
      </div>

      <div className="aes-prof-stats">
        <div className="aes-stat"><span className="aes-stat-v mono">{totalPts}</span><span className="aes-stat-k">Points</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{wins}</span><span className="aes-stat-k">Wins</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{podiums}</span><span className="aes-stat-k">Podiums</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{poles}</span><span className="aes-stat-k">Poles</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{fastLaps}</span><span className="aes-stat-k">Fastest laps</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{bestFinish ? "P" + bestFinish : "—"}</span><span className="aes-stat-k">Best finish</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{avgFinish ? "P" + avgFinish.toFixed(1) : "—"}</span><span className="aes-stat-k">Avg finish</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{races.length}</span><span className="aes-stat-k">Races</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{lapsTotal}</span><span className="aes-stat-k">Laps</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{bestLap || "—"}</span><span className="aes-stat-k">Best lap</span></div>
        <div className="aes-stat"><span className="aes-stat-v mono">{incTotal}</span><span className="aes-stat-k">Incidents</span></div>
      </div>

      {races.length > 0 && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Flag size={16} /> Race-by-race</h2></div>
          <div className="aes-rt-wrap">
            <table className="aes-results-table">
              <thead><tr><th>Rd</th><th>Event</th><th>Class pos</th><th>Best lap</th><th>Inc</th><th>Status</th><th>Pts</th></tr></thead>
              <tbody>
                {races.map((x, i) => (
                  <tr key={i}>
                    <td className="mono">R{x.ev.round}</td>
                    <td><button className="aes-link-driver" onClick={() => openEvent && openEvent(x.ev.id)}>{x.ev.track.split(" ")[0]}</button></td>
                    <td className="aes-results-pos">{x.r.clsPos ? "P" + x.r.clsPos : "—"}</td>
                    <td className="mono dim">{x.r.best || "—"}</td>
                    <td className="mono dim">{x.r.inc !== "" && x.r.inc != null ? x.r.inc : "—"}</td>
                    <td className="mono dim">{x.r.status || "—"}</td>
                    <td className="mono pts">{x.r.points ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {progression.length > 1 && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Gauge size={16} /> Championship points</h2></div>
          <div className="aes-chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={progression} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                <CartesianGrid stroke="#22303f" vertical={false} />
                <XAxis dataKey="round" stroke="#7f8a99" tick={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace" }} />
                <YAxis stroke="#7f8a99" tick={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace" }} />
                <Tooltip contentStyle={{ background: "#10151f", border: "1px solid #2a3645", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e8ecf2" }} />
                <Line type="monotone" dataKey="pts" name="Points" stroke="#F5EE30" strokeWidth={2.4} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {lapRaces.length > 0 && (
        <section className="aes-card">
          <div className="aes-card-head aes-card-head-row">
            <h2><Timer size={16} /> Lap times</h2>
            {lapRaces.length > 1 && (
              <select className="aes-input aes-lap-sel" value={lapSel || ""} onChange={(e) => setLapSel(e.target.value)}>
                {lapRaces.map((x) => <option key={x.ev.id} value={x.ev.id}>{x.ev.track.split(" ")[0]}</option>)}
              </select>
            )}
          </div>
          <div className="aes-chart">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lapData} margin={{ top: 8, right: 16, bottom: 4, left: 6 }}>
                <CartesianGrid stroke="#22303f" vertical={false} />
                <XAxis dataKey="lap" stroke="#7f8a99" tick={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                <YAxis domain={[(min) => Math.floor(min - 1), yMax]} stroke="#7f8a99" tickFormatter={fmtLapAxis} width={54}
                  tick={{ fontSize: 11, fontFamily: "JetBrains Mono, monospace" }} />
                <Tooltip formatter={(v) => fmtLapAxis(v)} labelFormatter={(l) => "Lap " + l}
                  contentStyle={{ background: "#10151f", border: "1px solid #2a3645", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e8ecf2" }} />
                <Line type="monotone" dataKey="sec" name="Lap" stroke="#37C2F0" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="aes-lap-note">Pit, traffic and incident laps show as spikes; the axis trims extreme outliers for readability.</div>
        </section>
      )}

      {races.length === 0 && progression.length <= 1 && (
        <div className="aes-empty">No race results recorded for this driver yet. Import a results PDF from the admin panel to fill in their profile.</div>
      )}
    </div>
  );
}

/* =============================== Standings ================================ */
function Standings({ data, openDriver }) {
  const [mode, setMode] = useState("drivers");
  const [clsFilter, setClsFilter] = useState("ALL");
  const completedRounds = data.events.filter((e) => e.status === "complete");

  const driverRows = useMemo(() => {
    let rows = data.drivers.map((d) => ({ ...d, pts: driverPoints(d, data.events), team: data.teams.find((t) => t.id === d.teamId) }));
    if (clsFilter !== "ALL") rows = rows.filter((r) => r.cls === clsFilter);
    return rows.sort((a, b) => b.pts - a.pts);
  }, [data, clsFilter]);

  const teamRows = useMemo(() => {
    const rows = data.teams.map((t) => {
      const ds = data.drivers.filter((d) => d.teamId === t.id);
      const pts = ds.reduce((a, d) => a + driverPoints(d, data.events), 0);
      const classes = [...new Set(ds.map((d) => d.cls))];
      return { ...t, pts, drivers: ds.length, classes };
    });
    return rows.filter((t) => t.drivers > 0).sort((a, b) => b.pts - a.pts);
  }, [data]);

  const chartData = useMemo(() => {
    const cls = clsFilter === "ALL" ? null : clsFilter;
    let pool = data.drivers.map((d) => ({ ...d, pts: driverPoints(d, data.events) }));
    if (cls) pool = pool.filter((d) => d.cls === cls);
    const top = pool.sort((a, b) => b.pts - a.pts).slice(0, 5);
    const ordered = [...completedRounds].sort((a, b) => a.round - b.round);
    return {
      series: top.map((d, i) => ({ key: d.id, name: d.name.split(" ").slice(-1)[0], color: LINE_COLORS[i % LINE_COLORS.length] })),
      rows: ordered.map((e, idx) => {
        const row = { round: "R" + e.round };
        top.forEach((d) => {
          row[d.id] = ordered.slice(0, idx + 1).reduce((a, ev) => a + roundPoints(d, ev), 0);
        });
        return row;
      }),
    };
  }, [data, clsFilter, completedRounds]);

  const cleanRows = useMemo(() => {
    let rows = data.drivers.map((d) => {
      let inc = 0, races = 0, laps = 0;
      data.events.forEach((ev) => {
        const r = (ev.results || []).find((x) => String(x.num) === String(d.num) && x.cls === d.cls);
        if (r) { races++; inc += Number(r.inc) || 0; laps += Number(r.laps) || 0; }
      });
      return { ...d, inc, races, laps, perRace: races ? inc / races : 0, team: data.teams.find((t) => t.id === d.teamId) };
    }).filter((d) => d.races > 0);
    if (clsFilter !== "ALL") rows = rows.filter((r) => r.cls === clsFilter);
    return rows.sort((a, b) => (a.perRace - b.perRace) || (a.inc - b.inc) || (b.laps - a.laps));
  }, [data, clsFilter]);

  const leaderPts = driverRows[0] ? driverRows[0].pts : 0;
  const leaderTeamPts = teamRows[0] ? teamRows[0].pts : 0;

  const makeRows = useMemo(() => {
    const cls = clsFilter === "ALL" ? null : clsFilter;
    const tally = {};
    data.events.forEach((ev) => (ev.results || []).forEach((r) => {
      if (cls && r.cls !== cls) return;
      const mk = makeOf(r.car); if (!mk) return;
      const pts = (Number(r.points) || 0) + (Number(r.adjust) || 0);
      tally[mk] = tally[mk] || { make: mk, pts: 0, classes: new Set(), entries: new Set() };
      tally[mk].pts += pts; tally[mk].classes.add(r.cls); tally[mk].entries.add(r.cls + "#" + r.num);
    }));
    return Object.values(tally).map((m) => ({ make: m.make, pts: m.pts, classes: [...m.classes], entries: m.entries.size })).sort((a, b) => b.pts - a.pts);
  }, [data, clsFilter]);
  const leaderMakePts = makeRows[0] ? makeRows[0].pts : 0;

  return (
    <div className="aes-page">
      <div className="aes-page-head">
        <h1>Championship</h1>
        <p>After {completedRounds.length} of {data.events.length} rounds · {data.league.season}</p>
      </div>

      <div className="aes-controls">
        <div className="aes-toggle">
          <button className={mode === "drivers" ? "on" : ""} onClick={() => setMode("drivers")}>Drivers</button>
          <button className={mode === "teams" ? "on" : ""} onClick={() => setMode("teams")}>Teams</button>
          <button className={mode === "manufacturers" ? "on" : ""} onClick={() => setMode("manufacturers")}>Manufacturers</button>
          <button className={mode === "clean" ? "on" : ""} onClick={() => setMode("clean")}>Cleanest</button>
        </div>
        {(mode === "drivers" || mode === "clean" || mode === "manufacturers") && (
          <div className="aes-toggle">
            <button className={clsFilter === "ALL" ? "on" : ""} onClick={() => setClsFilter("ALL")}>All</button>
            {data.classes.map((c) => (
              <button key={c.id} className={clsFilter === c.id ? "on" : ""} onClick={() => setClsFilter(c.id)} style={clsFilter === c.id ? { color: c.color } : {}}>{c.name}</button>
            ))}
          </div>
        )}
      </div>

      {mode === "drivers" && (
        <div className="aes-table-wrap">
          <table className="aes-table">
            <thead>
              <tr>
                <th className="num">#</th><th>Driver</th><th>Team</th><th className="ctr">Class</th>
                {completedRounds.map((e) => <th key={e.id} className="ctr rnd">R{e.round}</th>)}
                <th className="ctr">Pts</th><th className="ctr">Gap</th>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((d, i) => (
                <tr key={d.id}>
                  <td className="num mono">{i + 1}</td>
                  <td className="aes-td-driver">
                    <div className="aes-driver-line"><span className="aes-flag">{d.country}</span> <span className="aes-num-badge mono">{d.num}</span> <button className="aes-link-driver" onClick={() => openDriver && openDriver(d.id)}>{d.name}</button></div>
                    {d.car && <div className="aes-driver-car">{d.car}</div>}
                  </td>
                  <td className="aes-td-team">{d.team?.name || "—"}</td>
                  <td className="ctr"><ClassDot cls={d.cls} classes={data.classes} /></td>
                  {completedRounds.map((e) => <td key={e.id} className="ctr mono dim">{roundPoints(d, e) || "–"}</td>)}
                  <td className="ctr mono pts">{d.pts}</td>
                  <td className="ctr mono dim">{i === 0 ? "—" : "-" + (leaderPts - d.pts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === "teams" && (
        <div className="aes-table-wrap">
          <table className="aes-table">
            <thead><tr><th className="num">#</th><th>Team</th><th className="ctr">Classes</th><th className="ctr">Drivers</th><th className="ctr">Pts</th><th className="ctr">Gap</th></tr></thead>
            <tbody>
              {teamRows.map((t, i) => (
                <tr key={t.id}>
                  <td className="num mono">{i + 1}</td>
                  <td className="aes-td-driver">{t.name}</td>
                  <td className="ctr">{t.classes.map((c) => <ClassDot key={c} cls={c} classes={data.classes} />)}</td>
                  <td className="ctr mono dim">{t.drivers}</td>
                  <td className="ctr mono pts">{t.pts}</td>
                  <td className="ctr mono dim">{i === 0 ? "—" : "-" + (leaderTeamPts - t.pts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === "manufacturers" && (
        <div className="aes-table-wrap">
          <table className="aes-table">
            <thead><tr><th className="num">#</th><th>Manufacturer</th><th className="ctr">Classes</th><th className="ctr">Entries</th><th className="ctr">Pts</th><th className="ctr">Gap</th></tr></thead>
            <tbody>
              {makeRows.map((m, i) => (
                <tr key={m.make}>
                  <td className="num mono">{i + 1}</td>
                  <td className="aes-td-driver">{m.make}</td>
                  <td className="ctr">{m.classes.map((c) => <ClassDot key={c} cls={c} classes={data.classes} />)}</td>
                  <td className="ctr mono dim">{m.entries}</td>
                  <td className="ctr mono pts">{m.pts}</td>
                  <td className="ctr mono dim">{i === 0 ? "—" : "-" + (leaderMakePts - m.pts)}</td>
                </tr>
              ))}
              {makeRows.length === 0 && <tr><td colSpan={6} className="aes-filter-empty">No results yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {mode === "clean" && (
        <div className="aes-table-wrap">
          <table className="aes-table">
            <thead><tr><th className="num">#</th><th>Driver</th><th>Team</th><th className="ctr">Class</th><th className="ctr">Races</th><th className="ctr">Inc</th><th className="ctr">Inc/race</th></tr></thead>
            <tbody>
              {cleanRows.map((d, i) => (
                <tr key={d.id}>
                  <td className="num mono">{i + 1}</td>
                  <td className="aes-td-driver">
                    <div className="aes-driver-line"><span className="aes-flag">{d.country}</span> <span className="aes-num-badge mono">{d.num}</span> <button className="aes-link-driver" onClick={() => openDriver && openDriver(d.id)}>{d.name}</button></div>
                  </td>
                  <td className="aes-td-team">{d.team?.name || "—"}</td>
                  <td className="ctr"><ClassDot cls={d.cls} classes={data.classes} /></td>
                  <td className="ctr mono dim">{d.races}</td>
                  <td className="ctr mono">{d.inc}</td>
                  <td className="ctr mono pts">{d.perRace.toFixed(1)}</td>
                </tr>
              ))}
              {cleanRows.length === 0 && <tr><td colSpan={7} className="aes-filter-empty">No race incident data yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {mode === "drivers" && chartData.rows.length > 1 && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Gauge size={16} /> Points progression — top 5{clsFilter !== "ALL" ? " " + clsFilter : ""}</h2></div>
          <div className="aes-chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData.rows} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
                <CartesianGrid stroke="#22303f" vertical={false} />
                <XAxis dataKey="round" stroke="#7f8a99" tick={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace" }} />
                <YAxis stroke="#7f8a99" tick={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace" }} />
                <Tooltip contentStyle={{ background: "#10151f", border: "1px solid #2a3645", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#e8ecf2" }} />
                {chartData.series.map((s) => (
                  <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2.2} dot={{ r: 3 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="aes-chart-legend">
            {chartData.series.map((s) => (
              <span key={s.key}><i style={{ background: s.color }} /> {s.name}</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ================================== Info ================================== */
function Info({ data }) {
  const L = data.league;
  return (
    <div className="aes-page">
      <div className="aes-page-head"><h1>League Info</h1><p>Format, rules & how to get involved</p></div>

      <section className="aes-card">
        <div className="aes-card-head"><h2><Flag size={16} /> Format</h2></div>
        <div className="aes-info-grid">
          <div><dt>Discipline</dt><dd>Multi-class endurance — {data.classes.map((c) => c.name).join(" + ")}</dd></div>
          <div><dt>Rounds</dt><dd>{data.events.length} per season ({L.season})</dd></div>
          <div><dt>Race length</dt><dd>6 to 24 hours</dd></div>
          <div><dt>Drivers per car</dt><dd>2–6 depending on round</dd></div>
          <div><dt>Schedule</dt><dd>One round roughly every 4 weeks, {L.timezone}</dd></div>
          <div><dt>Scoring</dt><dd>Per-class points; finale pays double</dd></div>
        </div>
      </section>

      <section className="aes-card">
        <div className="aes-card-head"><h2><Radio size={16} /> Sporting essentials</h2></div>
        <ul className="aes-rules">
          <li>Minimum driver counts and maximum single-stint length are enforced per event — see each event page.</li>
          <li>Mandatory pit windows and fuel/tyre rules are published in the rulebook before each round.</li>
          <li>Incident points and protests are handled by Race Control; clean racing across class traffic is the priority.</li>
          <li>Cars must run league liveries and the correct car number for the season.</li>
        </ul>
      </section>

      <section className="aes-card">
        <div className="aes-card-head"><h2><Users size={16} /> Get involved</h2></div>
        <div className="aes-links">
          <a className="aes-link-card" href={L.links.discord} target="_blank" rel="noreferrer"><Radio size={18} /><span>Discord<em>Sign-ups, driver briefings & race control</em></span></a>
          <a className="aes-link-card" href={L.links.broadcast} target="_blank" rel="noreferrer"><Eye size={18} /><span>Broadcast<em>Live coverage of every round</em></span></a>
          <a className="aes-link-card" href={L.links.rulebook} target="_blank" rel="noreferrer"><Flag size={18} /><span>Rulebook<em>Full sporting & technical regulations</em></span></a>
        </div>
      </section>
    </div>
  );
}

/* ================================== ADMIN ================================= */
function Field({ label, children }) {
  return <label className="aes-field"><span>{label}</span>{children}</label>;
}
function TextInput(props) { return <input className="aes-input" {...props} />; }
function NumInput(props) { return <input type="number" className="aes-input" {...props} />; }

function CarSelect({ cls, value, onChange }) {
  const opts = useMemo(() => {
    const base = CARS[cls] || [];
    return value && !base.includes(value) ? [value, ...base] : base;
  }, [cls, value]);
  return (
    <select className="aes-input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select car —</option>
      {opts.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

const uid = () => Math.random().toString(36).slice(2, 9);

// Country list for the flag typeahead. Flags are derived from ISO codes,
// except where an explicit `flag` is given (England/Scotland/Wales).
const COUNTRIES = [
  { name: "Argentina", code: "AR" }, { name: "Australia", code: "AU" },
  { name: "Austria", code: "AT" }, { name: "Belgium", code: "BE" },
  { name: "Bolivia", code: "BO" }, { name: "Brazil", code: "BR" },
  { name: "Bulgaria", code: "BG" }, { name: "Canada", code: "CA" },
  { name: "Chile", code: "CL" }, { name: "China", code: "CN" },
  { name: "Colombia", code: "CO" }, { name: "Costa Rica", code: "CR" },
  { name: "Croatia", code: "HR" }, { name: "Cyprus", code: "CY" },
  { name: "Czechia", code: "CZ" }, { name: "Denmark", code: "DK" },
  { name: "Ecuador", code: "EC" }, { name: "Egypt", code: "EG" },
  { name: "England", code: "GB-ENG", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}" },
  { name: "Estonia", code: "EE" }, { name: "Finland", code: "FI" },
  { name: "France", code: "FR" }, { name: "Germany", code: "DE" },
  { name: "Greece", code: "GR" }, { name: "Hong Kong", code: "HK" },
  { name: "Hungary", code: "HU" }, { name: "Iceland", code: "IS" },
  { name: "India", code: "IN" }, { name: "Indonesia", code: "ID" },
  { name: "Ireland", code: "IE" }, { name: "Israel", code: "IL" },
  { name: "Italy", code: "IT" }, { name: "Japan", code: "JP" },
  { name: "Latvia", code: "LV" }, { name: "Lithuania", code: "LT" },
  { name: "Luxembourg", code: "LU" }, { name: "Malaysia", code: "MY" },
  { name: "Malta", code: "MT" }, { name: "Mexico", code: "MX" },
  { name: "Monaco", code: "MC" }, { name: "Morocco", code: "MA" },
  { name: "Netherlands", code: "NL" }, { name: "New Zealand", code: "NZ" },
  { name: "Norway", code: "NO" }, { name: "Peru", code: "PE" },
  { name: "Philippines", code: "PH" }, { name: "Poland", code: "PL" },
  { name: "Portugal", code: "PT" }, { name: "Qatar", code: "QA" },
  { name: "Romania", code: "RO" }, { name: "Russia", code: "RU" },
  { name: "Saudi Arabia", code: "SA" }, { name: "Scotland", code: "GB-SCT", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}" },
  { name: "Singapore", code: "SG" }, { name: "Slovakia", code: "SK" },
  { name: "Slovenia", code: "SI" }, { name: "South Africa", code: "ZA" },
  { name: "South Korea", code: "KR" }, { name: "Spain", code: "ES" },
  { name: "Sweden", code: "SE" }, { name: "Switzerland", code: "CH" },
  { name: "Taiwan", code: "TW" }, { name: "Thailand", code: "TH" },
  { name: "Turkey", code: "TR" }, { name: "Ukraine", code: "UA" },
  { name: "United Arab Emirates", code: "AE" }, { name: "United Kingdom", code: "GB" },
  { name: "United States", code: "US" }, { name: "Uruguay", code: "UY" },
  { name: "Venezuela", code: "VE" }, { name: "Vietnam", code: "VN" },
  { name: "Albania", code: "AL" }, { name: "Algeria", code: "DZ" },
  { name: "Andorra", code: "AD" }, { name: "Armenia", code: "AM" },
  { name: "Azerbaijan", code: "AZ" }, { name: "Bahrain", code: "BH" },
  { name: "Bangladesh", code: "BD" }, { name: "Belarus", code: "BY" },
  { name: "Bosnia and Herzegovina", code: "BA" }, { name: "Cambodia", code: "KH" },
  { name: "Cuba", code: "CU" }, { name: "Dominican Republic", code: "DO" },
  { name: "Georgia", code: "GE" }, { name: "Ghana", code: "GH" },
  { name: "Guatemala", code: "GT" }, { name: "Iran", code: "IR" },
  { name: "Iraq", code: "IQ" }, { name: "Jamaica", code: "JM" },
  { name: "Jordan", code: "JO" }, { name: "Kazakhstan", code: "KZ" },
  { name: "Kenya", code: "KE" }, { name: "Kuwait", code: "KW" },
  { name: "Lebanon", code: "LB" }, { name: "Liechtenstein", code: "LI" },
  { name: "Nigeria", code: "NG" }, { name: "North Macedonia", code: "MK" },
  { name: "Pakistan", code: "PK" }, { name: "Panama", code: "PA" },
  { name: "Paraguay", code: "PY" }, { name: "Puerto Rico", code: "PR" },
  { name: "Serbia", code: "RS" }, { name: "Sri Lanka", code: "LK" },
  { name: "Tunisia", code: "TN" },
  { name: "Wales", code: "GB-WLS", flag: "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}" },
];

const flagOf = (code) =>
  code.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()
    .replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));

const flagFor = (c) => c.flag || flagOf(c.code);

function CountrySelect({ value, onChange }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return COUNTRIES
      .filter((c) => c.name.toLowerCase().includes(t))
      .sort((a, b) => {
        const as = a.name.toLowerCase().startsWith(t) ? 0 : 1;
        const bs = b.name.toLowerCase().startsWith(t) ? 0 : 1;
        return as - bs || a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [q]);
  const pick = (c) => { onChange(flagFor(c)); setQ(c.name); setOpen(false); };
  return (
    <div className="aes-cs">
      <div className="aes-cs-field">
        <span className="aes-cs-flag">{value || "\uD83C\uDFF3\uFE0F"}</span>
        <input value={q} placeholder="Type a country…"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)} />
      </div>
      {open && matches.length > 0 && (
        <div className="aes-cs-menu">
          {matches.map((c) => (
            <button key={c.code} type="button" className="aes-cs-opt"
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}>
              <span>{flagFor(c)}</span> {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


function AdminPanel({ data, setData, save, persisted, onClose, resetSample }) {
  const [tab, setTab] = useState("events");
  const [savedFlash, setSavedFlash] = useState(false);
  const [driverQ, setDriverQ] = useState("");
  const [driverCls, setDriverCls] = useState("ALL");
  const [teamQ, setTeamQ] = useState("");
  const fileRef = useRef(null);

  const commit = async (next) => {
    setData(next);
    const ok = await save(next);
    if (ok) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400); }
  };

  /* ----- events ----- */
  const updateEvent = (id, patch) => commit({ ...data, events: data.events.map((e) => e.id === id ? { ...e, ...patch } : e) });
  const addEvent = () => {
    const round = data.events.length + 1;
    const ne = { id: uid(), round, track: "New Circuit", location: "TBD", durationH: 6, durationMin: 360,
      date: new Date().toISOString().slice(0, 19), status: "upcoming", simStartHour: 12, timeMult: 1,
      entries: 0, minDrivers: 2, maxDrivers: 4,
      sessions: [{ type: "Race", start: new Date().toISOString().slice(0, 19), durMin: 360 }],
      weather: [{ atHour: 0, air: 68, sky: "Clear", precip: 0, wind: 6, humidity: 55 }],
      notes: "", winners: null };
    commit({ ...data, events: [...data.events, ne] });
  };
  const delEvent = (id) => commit({ ...data, events: data.events.filter((e) => e.id !== id) });

  /* apply a deciphered PDF: patch the event + write computed points to matched drivers, in one commit */
  const importResults = (evId, eventPatch, driverPoints) => {
    commit({
      ...data,
      events: data.events.map((e) => (e.id === evId ? { ...e, ...eventPatch } : e)),
      drivers: data.drivers.map((d) => (d.id in driverPoints ? { ...d, pointsByRound: driverPoints[d.id] } : d)),
    });
  };

  /* ----- drivers ----- */
  const updateDriver = (id, patch) => commit({ ...data, drivers: data.drivers.map((d) => d.id === id ? { ...d, ...patch } : d) });
  const addDriver = () => commit({ ...data, drivers: [...data.drivers, { id: uid(), num: 0, name: "New Driver", teamId: data.teams[0]?.id || "", cls: data.classes[0]?.id || "GTP", country: "🏳️", car: "", pointsByRound: [] }] });
  const delDriver = (id) => commit({ ...data, drivers: data.drivers.filter((x) => x.id !== id) });

  /* ----- teams ----- */
  const updateTeam = (id, patch) => commit({ ...data, teams: data.teams.map((t) => t.id === id ? { ...t, ...patch } : t) });
  const addTeam = () => commit({ ...data, teams: [...data.teams, { id: uid(), name: "New Team" }] });
  const delTeam = (id) => commit({
    ...data,
    teams: data.teams.filter((x) => x.id !== id),
    drivers: data.drivers.map((x) => (x.teamId === id ? { ...x, teamId: null } : x)),
  });

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "league-data.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { commit(JSON.parse(r.result)); } catch { alert("Invalid JSON file."); } };
    r.readAsText(f);
  };

  const teamNameOf = (id) => { const t = data.teams.find((x) => x.id === id); return t ? t.name : ""; };
  const dq = driverQ.trim().toLowerCase();
  const shownDrivers = data.drivers.filter((d) => {
    if (driverCls !== "ALL" && d.cls !== driverCls) return false;
    if (!dq) return true;
    return [d.name, d.num, d.car, d.cls, teamNameOf(d.teamId)].some((v) => String(v == null ? "" : v).toLowerCase().includes(dq));
  });
  const tq = teamQ.trim().toLowerCase();
  const shownTeams = data.teams.filter((t) => !tq || String(t.name || "").toLowerCase().includes(tq));

  return (
    <div className="aes-admin">
      <div className="aes-admin-top">
        <div className="aes-admin-title"><Settings size={18} /> Race Control <span className="aes-admin-mode">ADMIN</span></div>
        <div className="aes-admin-actions">
          {savedFlash && <span className="aes-saved"><CheckCircle2 size={14} /> Saved</span>}
          {!persisted && <span className="aes-warn-pill">Preview only — not persisting</span>}
          <button className="aes-btn ghost sm" onClick={exportJson}><Download size={14} /> Export</button>
          <button className="aes-btn ghost sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={importJson} />
          <button className="aes-btn ghost sm" onClick={resetSample}><RotateCcw size={14} /> Reset</button>
          <button className="aes-btn primary sm" onClick={onClose}><Eye size={14} /> View site</button>
        </div>
      </div>

      <div className="aes-admin-tabs">
        {[["events", "Events"], ["drivers", "Drivers"], ["teams", "Teams"], ["league", "League"]].map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      <div className="aes-admin-body">
        {tab === "events" && (
          <>
            <div className="aes-admin-addbar"><button className="aes-btn primary sm" onClick={addEvent}><Plus size={14} /> Add event</button></div>
            {data.events.map((ev) => (
              <EventEditor key={ev.id} ev={ev} data={data} classes={data.classes}
                onChange={(patch) => updateEvent(ev.id, patch)} onImport={(patch, dp) => importResults(ev.id, patch, dp)} onDelete={() => delEvent(ev.id)} />
            ))}
          </>
        )}

        {tab === "drivers" && (
          <>
            <div className="aes-admin-addbar">
              <button className="aes-btn primary sm" onClick={addDriver}><Plus size={14} /> Add driver</button>
              <div className="aes-filter">
                <Search size={14} />
                <input className="aes-filter-input" placeholder="Filter by name, number, car or team…" value={driverQ} onChange={(e) => setDriverQ(e.target.value)} />
              </div>
              <select className="aes-input aes-filter-cls" value={driverCls} onChange={(e) => setDriverCls(e.target.value)}>
                <option value="ALL">All classes</option>
                {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="aes-edit-list">
              <div className="aes-edit-row driver head">
                <span>#</span><span>Driver name</span><span>Country</span><span>Team</span><span>Class</span><span>Car</span><span>Pts</span><span></span>
              </div>
              {shownDrivers.map((d) => (
                <div key={d.id} className="aes-edit-row driver">
                  <NumInput value={d.num} onChange={(e) => updateDriver(d.id, { num: +e.target.value })} placeholder="#" />
                  <TextInput value={d.name} onChange={(e) => updateDriver(d.id, { name: e.target.value })} placeholder="Driver name" />
                  <CountrySelect value={d.country} onChange={(flag) => updateDriver(d.id, { country: flag })} />
                  <select className="aes-input" value={d.teamId || ""} onChange={(e) => updateDriver(d.id, { teamId: e.target.value || null })}>
                    <option value="">— No team —</option>
                    {data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select className="aes-input" value={d.cls} onChange={(e) => updateDriver(d.id, { cls: e.target.value })}>
                    {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <CarSelect cls={d.cls} value={d.car} onChange={(v) => updateDriver(d.id, { car: v })} />
                  <span className="aes-edit-total mono">{driverPoints(d, data.events)}</span>
                  <div className="aes-edit-actions">
                    <button className="aes-icon-btn danger" onClick={() => delDriver(d.id)}><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
              {shownDrivers.length === 0 && <div className="aes-filter-empty">No drivers match “{driverQ}”{driverCls !== "ALL" ? " in " + driverCls : ""}.</div>}
            </div>
            <p className="aes-hint">Points are totalled automatically from each event's results (matched by car number). Enter or correct results in the event's “Results &amp; points” section; team totals follow from driver points.</p>
          </>
        )}

        {tab === "teams" && (
          <>
            <div className="aes-admin-addbar">
              <button className="aes-btn primary sm" onClick={addTeam}><Plus size={14} /> Add team</button>
              <div className="aes-filter">
                <Search size={14} />
                <input className="aes-filter-input" placeholder="Filter teams…" value={teamQ} onChange={(e) => setTeamQ(e.target.value)} />
              </div>
            </div>
            <div className="aes-edit-list">
              <div className="aes-edit-row team head">
                <span>Team name</span><span>Drivers</span><span></span>
              </div>
              {shownTeams.map((t) => {
                const count = data.drivers.filter((d) => d.teamId === t.id).length;
                return (
                  <div key={t.id} className="aes-edit-row team">
                    <TextInput value={t.name} onChange={(e) => updateTeam(t.id, { name: e.target.value })} placeholder="Team name" />
                    <span className="aes-edit-meta mono">{count} driver{count !== 1 ? "s" : ""}</span>
                    <div className="aes-edit-actions">
                      <button className="aes-icon-btn danger" title="Delete team" onClick={() => delTeam(t.id)}><Trash2 size={15} /></button>
                    </div>
                  </div>
                );
              })}
              {shownTeams.length === 0 && <div className="aes-filter-empty">No teams match “{teamQ}”.</div>}
            </div>
          </>
        )}

        {tab === "league" && (
          <div className="aes-edit-card">
            <div className="aes-edit-grid">
              <Field label="League name"><TextInput value={data.league.name} onChange={(e) => commit({ ...data, league: { ...data.league, name: e.target.value } })} /></Field>
              <Field label="Season"><TextInput value={data.league.season} onChange={(e) => commit({ ...data, league: { ...data.league, season: e.target.value } })} /></Field>
              <Field label="Tagline"><TextInput value={data.league.tagline} onChange={(e) => commit({ ...data, league: { ...data.league, tagline: e.target.value } })} /></Field>
              <Field label="Timezone label"><TextInput value={data.league.timezone} onChange={(e) => commit({ ...data, league: { ...data.league, timezone: e.target.value } })} /></Field>
              <Field label="Admin PIN"><TextInput value={data.league.adminPin} onChange={(e) => commit({ ...data, league: { ...data.league, adminPin: e.target.value } })} /></Field>
              <Field label="Discord link"><TextInput value={data.league.links.discord} onChange={(e) => commit({ ...data, league: { ...data.league, links: { ...data.league.links, discord: e.target.value } } })} /></Field>
              <Field label="Broadcast link"><TextInput value={data.league.links.broadcast} onChange={(e) => commit({ ...data, league: { ...data.league, links: { ...data.league.links, broadcast: e.target.value } } })} /></Field>
              <Field label="Rulebook link"><TextInput value={data.league.links.rulebook} onChange={(e) => commit({ ...data, league: { ...data.league, links: { ...data.league.links, rulebook: e.target.value } } })} /></Field>
            </div>
            <div className="aes-points-edit">
              <span className="aes-field-label">Championship points by finishing position</span>
              <input className="aes-input mono" value={(data.league.pointsTable || []).join(", ")}
                onChange={(e) => commit({ ...data, league: { ...data.league, pointsTable: e.target.value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)) } })} />
              <span className="aes-points-hint">P1 first, comma-separated. Used when a results PDF is imported — each class scores independently, and a round's points multiplier (e.g. a double-points finale) is applied on top. You can still edit any driver's points by hand in the Drivers tab.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ===================== Results PDF import (AI-deciphered) ================= */
const RESULTS_PROMPT = `You are reading a motorsport endurance race RESULTS pdf produced by race-control / timing software. Extract the official race classification from the main results table — one row per car.
Return ONLY pipe-delimited text — no prose, no markdown, no code fences.
The first line must be exactly:
pos|num|drivers|nat|car|grid|inc|laps|time|gap|best|status
Then one line per car, ordered by overall finishing position. Columns:
- pos: overall finishing position (integer)
- num: car number (digits only, no #)
- drivers: driver name(s); join co-drivers with " / "
- nat: nationality / country if shown, else empty
- car: full car/model name exactly as printed
- grid: starting grid position if shown, else empty
- inc: incident count if shown, else empty
- laps: laps completed (integer) or empty
- time: total or finishing time, or empty
- gap: gap to the leader (e.g. "1 LAP", "0:32.865") or empty
- best: best lap time or empty
- status: Running, Classified, DNF, DNS, DSQ, Disco, etc. or empty
Keep all pipe separators even when a field is empty. Use the real classified finishing order. Never invent data.`;

const LAPS_PROMPT_PREFIX = `This is a motorsport results pdf. Find the per-driver lap-by-lap section for the specified car/driver and return that driver's RACE lap times only.
Return ONLY pipe-delimited text — no prose, no code fences. First line exactly:
lap|time
Then one row per completed racing lap, in order: the lap number (integer) and the lap time (e.g. 1:35.433). Ignore sector times and any non-lap lines. Skip laps that have no time.
Car/driver to extract: `;

/* strip accents + non-alphanumerics for fuzzy matching */
function slug(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* derive GTP/LMP2/GTD from the car model via the CARS map (handles single-class timing exports) */
const MAKES = ["Acura", "Aston Martin", "BMW", "Cadillac", "Chevrolet", "Corvette", "Ferrari", "Ford", "Lamborghini", "Lexus", "McLaren", "Mercedes-AMG", "Mercedes", "Porsche", "Oreca", "Dallara"];
function makeOf(car) {
  const c = String(car || "").trim();
  if (!c) return "";
  for (const m of MAKES) {
    if (c.toLowerCase().startsWith(m.toLowerCase())) return m === "Mercedes" ? "Mercedes-AMG" : (m === "Corvette" ? "Chevrolet" : m);
  }
  return c.split(" ")[0];
}

function classFromCar(car, classes) {
  const cs = slug(car);
  if (!cs) return "";
  for (const clsId of Object.keys(CARS)) {
    if (!classes.some((c) => c.id === clsId)) continue;
    for (const model of CARS[clsId]) {
      const ms = slug(model);
      if (ms && (cs === ms || cs.includes(ms) || ms.includes(cs))) return clsId;
    }
  }
  return "";
}

function normalizeClass(raw, classes) {
  const r = slug(raw);
  if (!r) return "";
  for (const c of classes) {
    if (r === slug(c.id) || r === slug(c.name)) return c.id;
  }
  if (r === "GT3" && classes.some((c) => c.id === "GTD")) return "GTD";
  return "";
}

/* "1:35.433" or "95.433" -> seconds, else null */
function lapToSeconds(t) {
  const s = String(t || "").trim();
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? parseInt(m[1], 10) : 0) * 60 + parseFloat(m[2]);
}

/* seconds -> "1:35.4" for chart axes */
function fmtLapAxis(sec) {
  if (sec == null || isNaN(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? m + ":" + s.toFixed(1).padStart(4, "0") : s.toFixed(1);
}

function parseResultRows(text, data) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.includes("|")) continue;
    const p = t.split("|").map((x) => x.trim());
    if (!/^\d+$/.test(p[0])) continue; // skip header / notes
    const car = p[4] || "";
    out.push({
      pos: parseInt(p[0], 10),
      num: String(p[1] || "").replace(/^#/, ""),
      drivers: p[2] || "",
      nat: p[3] || "",
      car,
      cls: classFromCar(car, data.classes) || normalizeClass(p[3], data.classes),
      grid: p[5] && /^-?\d+$/.test(p[5]) ? parseInt(p[5], 10) : "",
      inc: p[6] && /^\d+$/.test(p[6]) ? parseInt(p[6], 10) : "",
      laps: p[7] && /^-?\d+$/.test(p[7]) ? parseInt(p[7], 10) : "",
      time: p[8] || "",
      gap: p[9] || "",
      best: p[10] || "",
      status: p[11] || "",
    });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function parseLapRows(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t.includes("|")) continue;
    const p = t.split("|").map((x) => x.trim());
    if (!/^\d+$/.test(p[0])) continue;
    const sec = lapToSeconds(p[1]);
    if (sec == null) continue;
    out.push({ lap: parseInt(p[0], 10), time: p[1], sec });
  }
  return out.sort((a, b) => a.lap - b.lap);
}

async function callClaudePDF(base64, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  if (!res.ok) throw new Error("The AI request failed (" + res.status + "). Try again in a moment.");
  const data = await res.json();
  return (data.content || []).map((i) => (i.type === "text" ? i.text : "")).join("");
}

async function getCarCount(base64) {
  try {
    const t = await callClaudePDF(base64, "Count how many cars are listed in the main race classification / results table of this PDF (one row per car). Reply with ONLY that integer and nothing else.");
    const m = String(t).match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  } catch (e) { return 0; }
}

async function decipherResultsPDF(base64, data, onProgress) {
  // Small fields fit in one pass; large fields are paged by position range so nothing truncates.
  const CHUNK = 15;
  const HARD_CAP = 105; // safety stop
  const count = await getCarCount(base64);
  if (count && count <= 24) {
    if (onProgress) onProgress("Reading the classification…");
    return parseResultRows(await callClaudePDF(base64, RESULTS_PROMPT), data);
  }
  const total = count || 60;
  const all = [];
  const seen = new Set();
  for (let start = 1; start <= HARD_CAP; start += CHUNK) {
    const end = start + CHUNK - 1;
    if (onProgress) onProgress(`Reading cars ${start}–${end}${count ? " of ~" + total : ""}…`);
    const prompt = RESULTS_PROMPT +
      `\n\nReturn ONLY the cars whose overall finishing position is between ${start} and ${end} inclusive. Do not include any car outside that range. If there are none in that range, return only the header line.`;
    let rows = [];
    try { rows = parseResultRows(await callClaudePDF(base64, prompt), data); } catch (e) { /* skip this chunk */ }
    let added = 0;
    for (const r of rows) {
      if (r.pos >= start && r.pos <= end && !seen.has(r.pos)) { seen.add(r.pos); all.push(r); added++; }
    }
    // Keep paging through the counted field; once past it, stop the first time a window is empty.
    if (start + CHUNK > total && added === 0) break;
  }
  if (!all.length) return parseResultRows(await callClaudePDF(base64, RESULTS_PROMPT), data);
  return all.sort((a, b) => a.pos - b.pos);
}

async function decipherDriverLaps(base64, who) {
  return parseLapRows(await callClaudePDF(base64, LAPS_PROMPT_PREFIX + who));
}

function pointsForPos(table, posInClass) {
  if (!Array.isArray(table) || posInClass < 1) return 0;
  return Number(table[posInClass - 1] || 0);
}

/* Attach derived class position, computed points, and driver match to each parsed row */
function buildImportRows(parsed, data, ev) {
  const table = data.league.pointsTable || [];
  const mult = Number(ev.pointsMult || 1);
  const seen = {};
  return parsed.map((r) => {
    seen[r.cls] = (seen[r.cls] || 0) + 1;
    const clsPos = seen[r.cls];
    const matches = data.drivers.filter((d) => String(d.num) === String(r.num) && d.cls === r.cls);
    return {
      ...r,
      clsPos,
      points: pointsForPos(table, clsPos) * mult,
      matchIds: matches.map((m) => m.id),
      matchNames: matches.map((m) => m.name),
    };
  });
}


function ResultsImport({ ev, data, onImport }) {
  const [stage, setStage] = useState(ev.results && ev.results.length ? "done" : "idle"); // idle | parsing | preview | laps | done
  const [over, setOver] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);
  const [b64, setB64] = useState("");
  const [pullLaps, setPullLaps] = useState(false);
  const [lapMsg, setLapMsg] = useState("");
  const [parseMsg, setParseMsg] = useState("");
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) { setErr("That doesn't look like a PDF — drop the results PDF from your race-control software."); return; }
    setErr(""); setStage("parsing");
    try {
      const data64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(",")[1]);
        fr.onerror = () => reject(new Error("Couldn't read that file."));
        fr.readAsDataURL(file);
      });
      const parsed = await decipherResultsPDF(data64, data, (m) => setParseMsg(m));
      if (!parsed.length) {
        setErr("I couldn't find a classified order in that PDF. If it's a scan or an unusual layout, send me a copy and I'll tune the reader.");
        setStage("idle"); return;
      }
      setB64(data64);
      setRows(buildImportRows(parsed, data, ev));
      setStage("preview");
    } catch (e) {
      setErr(e.message || "Something went wrong reading that PDF.");
      setStage("idle");
    }
  };

  const onDrop = (e) => { e.preventDefault(); setOver(false); handleFile(e.dataTransfer.files && e.dataTransfer.files[0]); };
  const setRowPts = (i, v) => setRows(rows.map((r, idx) => (idx === i ? { ...r, points: v === "" ? "" : Math.max(0, +v) } : r)));

  const apply = async () => {
    const winners = { ...(ev.winners || {}) };
    data.classes.forEach((c) => {
      const top = rows.filter((r) => r.cls === c.id).sort((a, b) => a.pos - b.pos)[0];
      if (top) winners[c.id] = ("#" + top.num + " " + top.drivers).trim();
    });
    const ri = (ev.round || 1) - 1;
    const ptsById = {};
    rows.forEach((r) => r.matchIds.forEach((id) => { ptsById[id] = Number(r.points || 0); }));
    const driverPoints = {};
    data.drivers.forEach((d) => {
      if (!(d.id in ptsById)) return;
      const pbr = [...(d.pointsByRound || [])];
      while (pbr.length <= ri) pbr.push(0);
      pbr[ri] = ptsById[d.id];
      driverPoints[d.id] = pbr;
    });

    let finalRows = rows;
    if (pullLaps && b64) {
      setStage("laps");
      const targets = rows.filter((r) => r.matchIds.length);
      const updated = rows.slice();
      for (let i = 0; i < targets.length; i++) {
        const r = targets[i];
        setLapMsg(`Reading lap times — ${i + 1}/${targets.length} (#${r.num} ${r.drivers})`);
        try {
          const lapChart = await decipherDriverLaps(b64, `car #${r.num}, driver ${r.drivers}`);
          updated[rows.indexOf(r)] = { ...r, lapChart };
        } catch (e) { /* skip this driver, keep going */ }
      }
      finalRows = updated;
    }

    const results = finalRows.map((r) => ({
      pos: r.pos, clsPos: r.clsPos, cls: r.cls, num: r.num, drivers: r.drivers, nat: r.nat, car: r.car,
      grid: r.grid, inc: r.inc, laps: r.laps, time: r.time, gap: r.gap, best: r.best, status: r.status,
      points: Number(r.points || 0), lapChart: r.lapChart || [],
    }));
    onImport({ results, winners, status: "complete" }, driverPoints);
    setStage("done");
  };

  const matched = rows.filter((r) => r.matchIds.length).length;

  return (
    <div className="aes-edit-sub">
      <div className="aes-edit-sub-head">
        <b>Import results from PDF</b>
        {stage === "done" && <button className="aes-btn ghost xs" onClick={() => { setRows([]); setStage("idle"); setErr(""); }}><Upload size={12} /> Import again</button>}
      </div>

      {stage === "idle" && (
        <>
          <div
            className={"aes-drop" + (over ? " over" : "")}
            onClick={() => inputRef.current && inputRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <FileText size={26} />
            <div className="aes-drop-title">Drop the race-control results PDF here</div>
            <div className="aes-drop-sub">or click to choose a file — I'll read the classification, work out each car's class, and assign points</div>
            <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => handleFile(e.target.files && e.target.files[0])} />
          </div>
          {err && <div className="aes-import-err"><AlertTriangle size={14} /> {err}</div>}
        </>
      )}

      {stage === "parsing" && (
        <div className="aes-drop">
          <Loader2 size={24} className="aes-spin" />
          <div className="aes-drop-title">Deciphering results…</div>
          <div className="aes-drop-sub">{parseMsg || "Reading the classification from your PDF"}</div>
        </div>
      )}

      {stage === "laps" && (
        <div className="aes-drop">
          <Loader2 size={24} className="aes-spin" />
          <div className="aes-drop-title">Reading lap charts…</div>
          <div className="aes-drop-sub">{lapMsg}</div>
        </div>
      )}

      {stage === "preview" && (
        <>
          <div className="aes-import-note">
            Read {rows.length} car{rows.length !== 1 ? "s" : ""} · {matched} matched to drivers by car number · class worked out from each car.
            Points auto-fill from your table{Number(ev.pointsMult || 1) !== 1 ? ` (×${ev.pointsMult} this round)` : ""} — edit any value before applying.
            Winners fill in automatically; unmatched cars are recorded but score no points until their number matches a driver.
          </div>
          <div className="aes-rt-wrap">
            <table className="aes-results-table">
              <thead>
                <tr><th>Pos</th><th>Cls</th><th>#</th><th>Drivers</th><th>Car</th><th>Grid</th><th>Laps</th><th>Best</th><th>Inc</th><th>Status</th><th>Driver</th><th>Pts</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.matchIds.length ? "" : "unmatched"}>
                    <td className="aes-results-pos">{r.pos}</td>
                    <td><ClassDot cls={r.cls} classes={data.classes} /></td>
                    <td className="mono">{r.num}</td>
                    <td>{r.drivers}</td>
                    <td className="dim aes-rt-car">{r.car || "—"}</td>
                    <td className="mono dim">{r.grid !== "" ? r.grid : "—"}</td>
                    <td className="mono dim">{r.laps !== "" ? r.laps : "—"}</td>
                    <td className="mono dim">{r.best || "—"}</td>
                    <td className="mono dim">{r.inc !== "" ? r.inc : "—"}</td>
                    <td className="mono dim">{r.status || "—"}</td>
                    <td className="aes-rt-match">{r.matchNames.length ? r.matchNames.join(", ") : <span className="aes-rt-nomatch">no match</span>}</td>
                    <td><input type="number" className="aes-input aes-rt-pts" value={r.points} onChange={(e) => setRowPts(i, e.target.value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="aes-laps-toggle">
            <input type="checkbox" checked={pullLaps} onChange={(e) => setPullLaps(e.target.checked)} />
            Also read per-driver lap charts for the {matched} matched car{matched !== 1 ? "s" : ""} (shows in driver profiles — adds about a second per car)
          </label>
          <div className="aes-import-actions">
            <button className="aes-btn primary sm" onClick={apply}><CheckCircle2 size={14} /> Apply to event</button>
            <button className="aes-btn ghost sm" onClick={() => { setRows([]); setStage("idle"); }}>Discard</button>
          </div>
        </>
      )}

      {stage === "done" && (
        <div className="aes-import-done"><CheckCircle2 size={15} /> Results applied — {(ev.results || []).length} cars classified, winners and points set. Fine-tune any points in the Drivers tab.</div>
      )}
    </div>
  );
}


function ResultsEditor({ ev, data, onChange, onImport }) {
  const rows = ev.results || [];
  const setRows = (next) => onChange({ results: next });
  const setRow = (i, patch) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows([...rows, { pos: rows.length + 1, cls: (data.classes[0] && data.classes[0].id) || "", num: "", drivers: "", car: "", grid: "", laps: "", best: "", gap: "", inc: "", status: "Running", clsPos: null, points: "", adjust: "" }]);
  const delRow = (i) => setRows(rows.filter((_, idx) => idx !== i));

  // rank within class by pos; mode "auto" overwrites points, "keep" only fills blanks
  const ranked = (mode) => {
    const table = data.league.pointsTable || [];
    const mult = Number(ev.pointsMult || 1);
    const order = rows.map((r, i) => ({ i, pos: +r.pos || 999 })).sort((a, b) => a.pos - b.pos);
    const seen = {};
    const out = rows.slice();
    order.forEach(({ i }) => {
      const r = rows[i];
      seen[r.cls] = (seen[r.cls] || 0) + 1;
      const clsPos = seen[r.cls];
      const auto = pointsForPos(table, clsPos) * mult;
      const pts = mode === "auto" ? auto : (r.points === "" || r.points == null ? auto : Number(r.points));
      out[i] = { ...r, clsPos, points: pts };
    });
    return out;
  };

  const autofill = () => setRows(ranked("auto"));

  const apply = () => {
    const updated = ranked("keep");
    const winners = { ...(ev.winners || {}) };
    data.classes.forEach((c) => {
      const top = updated.filter((r) => r.cls === c.id).sort((a, b) => (a.clsPos || 99) - (b.clsPos || 99))[0];
      if (top) winners[c.id] = ("#" + top.num + " " + top.drivers).trim();
    });
    const ri = (ev.round || 1) - 1;
    const ptsById = {};
    updated.forEach((r) => data.drivers.filter((d) => String(d.num) === String(r.num) && d.cls === r.cls).forEach((m) => { ptsById[m.id] = Number(r.points || 0) + Number(r.adjust || 0); }));
    const driverPoints = {};
    data.drivers.forEach((d) => {
      if (!(d.id in ptsById)) return;
      const pbr = [...(d.pointsByRound || [])];
      while (pbr.length <= ri) pbr.push(0);
      pbr[ri] = ptsById[d.id];
      driverPoints[d.id] = pbr;
    });
    onImport({ results: updated, winners, status: "complete" }, driverPoints);
  };

  return (
    <div className="aes-edit-sub">
      <div className="aes-edit-sub-head">
        <b>Results &amp; points — manual entry</b>
        <button className="aes-btn ghost xs" onClick={addRow}><Plus size={12} /> Add car</button>
      </div>
      {rows.length === 0 ? (
        <div className="aes-import-note">No results yet. Drop a PDF in the section above, or add cars by hand here.</div>
      ) : (
        <>
          <div className="aes-res-scroll">
            <div className="aes-res-grid">
              <div className="aes-res-head">
                <span>Pos</span><span>Class</span><span>#</span><span>Driver(s)</span><span>Car</span><span>Grid</span><span>Laps</span><span>Best lap</span><span>Inc</span><span>Status</span><span>Pts</span><span>Adj</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={i} className="aes-res-row">
                  <NumInput value={r.pos} onChange={(e) => setRow(i, { pos: +e.target.value })} />
                  <select className="aes-input" value={r.cls} onChange={(e) => setRow(i, { cls: e.target.value })}>
                    {data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <TextInput value={r.num} onChange={(e) => setRow(i, { num: e.target.value })} placeholder="#" />
                  <TextInput value={r.drivers} onChange={(e) => setRow(i, { drivers: e.target.value })} placeholder="Driver(s)" />
                  <TextInput value={r.car} onChange={(e) => setRow(i, { car: e.target.value })} placeholder="Car" />
                  <NumInput value={r.grid} onChange={(e) => setRow(i, { grid: e.target.value === "" ? "" : +e.target.value })} />
                  <NumInput value={r.laps} onChange={(e) => setRow(i, { laps: e.target.value === "" ? "" : +e.target.value })} />
                  <TextInput value={r.best} onChange={(e) => setRow(i, { best: e.target.value })} placeholder="1:35.4" />
                  <NumInput value={r.inc} onChange={(e) => setRow(i, { inc: e.target.value === "" ? "" : +e.target.value })} />
                  <TextInput value={r.status} onChange={(e) => setRow(i, { status: e.target.value })} placeholder="Running" />
                  <NumInput value={r.points} onChange={(e) => setRow(i, { points: e.target.value === "" ? "" : +e.target.value })} />
                  <NumInput value={r.adjust ?? ""} title="Stewards' adjustment (± points). Use for penalties or bonuses." onChange={(e) => setRow(i, { adjust: e.target.value === "" ? "" : +e.target.value })} />
                  <button className="aes-icon-btn danger" onClick={() => delRow(i)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          <div className="aes-import-actions">
            <button className="aes-btn ghost sm" onClick={autofill}><Gauge size={14} /> Auto-fill points</button>
            <button className="aes-btn primary sm" onClick={apply}><CheckCircle2 size={14} /> Apply to standings</button>
          </div>
          <div className="aes-points-hint">“Auto-fill points” fills each car's Pts from your points table by class position (you can then tweak any value). “Apply to standings” writes those points to the matched drivers by car number, sets the class winners, and marks the round complete.</div>
        </>
      )}
    </div>
  );
}

function EventEditor({ ev, data, classes, onChange, onImport, onDelete }) {
  const [open, setOpen] = useState(false);
  const setSession = (i, patch) => onChange({ sessions: ev.sessions.map((s, idx) => idx === i ? { ...s, ...patch } : s) });
  const addSession = () => onChange({ sessions: [...ev.sessions, { type: "Practice", start: ev.date, durMin: 60 }] });
  const delSession = (i) => onChange({ sessions: ev.sessions.filter((_, idx) => idx !== i) });
  const setWx = (i, patch) => onChange({ weather: ev.weather.map((w, idx) => idx === i ? { ...w, ...patch } : w) });
  const addWx = () => onChange({ weather: [...ev.weather, { atHour: 0, air: 68, sky: "Clear", precip: 0, wind: 6, humidity: 55 }] });
  const delWx = (i) => onChange({ weather: ev.weather.filter((_, idx) => idx !== i) });

  return (
    <div className="aes-edit-card">
      <div className="aes-edit-card-head" onClick={() => setOpen(!open)}>
        <span className="mono aes-edit-round">R{ev.round}</span>
        <span className="aes-edit-track">{ev.track}</span>
        <StatusChip status={ev.status} />
        <span className="aes-edit-spacer" />
        <button className="aes-icon-btn danger" onClick={(e) => { e.stopPropagation(); onDelete(); }}><Trash2 size={15} /></button>
        <ChevronRight size={18} className={"aes-edit-chev" + (open ? " open" : "")} />
      </div>
      {open && (
        <div className="aes-edit-card-body">
          <div className="aes-edit-grid">
            <Field label="Round #"><NumInput value={ev.round} onChange={(e) => onChange({ round: +e.target.value })} /></Field>
            <Field label="Track"><TextInput value={ev.track} onChange={(e) => onChange({ track: e.target.value })} /></Field>
            <Field label="Location"><TextInput value={ev.location} onChange={(e) => onChange({ location: e.target.value })} /></Field>
            <Field label="Duration (minutes)"><NumInput value={Math.round((ev.durationH || 0) * 60)} onChange={(e) => onChange({ durationH: (+e.target.value) / 60, durationMin: +e.target.value })} /></Field>
            <Field label="Race date/time"><TextInput type="datetime-local" value={ev.date.slice(0, 16)} onChange={(e) => onChange({ date: e.target.value + ":00" })} /></Field>
            <Field label="Status">
              <select className="aes-input" value={ev.status} onChange={(e) => onChange({ status: e.target.value })}>
                <option value="upcoming">Scheduled</option><option value="next">Next Up</option><option value="complete">Final</option>
              </select>
            </Field>
            <Field label="Sim start hour (0–24)"><NumInput step="0.5" value={ev.simStartHour} onChange={(e) => onChange({ simStartHour: +e.target.value })} /></Field>
            <Field label="Time multiplier"><NumInput step="0.5" value={ev.timeMult} onChange={(e) => onChange({ timeMult: +e.target.value })} /></Field>
            <Field label="Entries"><NumInput value={ev.entries} onChange={(e) => onChange({ entries: +e.target.value })} /></Field>
            <Field label="Min drivers"><NumInput value={ev.minDrivers} onChange={(e) => onChange({ minDrivers: +e.target.value })} /></Field>
            <Field label="Max drivers"><NumInput value={ev.maxDrivers} onChange={(e) => onChange({ maxDrivers: +e.target.value })} /></Field>
            <Field label="Points multiplier"><NumInput step="0.5" value={ev.pointsMult ?? 1} onChange={(e) => onChange({ pointsMult: +e.target.value })} /></Field>
          </div>

          <Field label="Race control notes"><textarea className="aes-input" rows={2} value={ev.notes} onChange={(e) => onChange({ notes: e.target.value })} /></Field>

          <div className="aes-edit-sub">
            <div className="aes-edit-sub-head"><b>Sessions</b><button className="aes-btn ghost xs" onClick={addSession}><Plus size={12} /> Add</button></div>
            {ev.sessions.map((s, i) => (
              <div key={i} className="aes-edit-srow">
                <select className="aes-input" value={s.type} onChange={(e) => setSession(i, { type: e.target.value })}>
                  <option>Practice</option><option>Qualifying</option><option>Warmup</option><option>Race</option>
                </select>
                <TextInput type="datetime-local" value={s.start.slice(0, 16)} onChange={(e) => setSession(i, { start: e.target.value + ":00" })} />
                <NumInput value={s.durMin} style={{ width: 90 }} onChange={(e) => setSession(i, { durMin: +e.target.value })} placeholder="min" />
                <button className="aes-icon-btn danger" onClick={() => delSession(i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="aes-edit-sub">
            <div className="aes-edit-sub-head"><b>Weather points</b><button className="aes-btn ghost xs" onClick={addWx}><Plus size={12} /> Add</button></div>
            <div className="aes-wx-edit-head"><span>Race hour</span><span>Air °F</span><span>Sky</span><span>Rain %</span><span>Wind (mph)</span><span>Humidity</span><span /></div>
            {ev.weather.map((w, i) => (
              <div key={i} className="aes-edit-wrow">
                <NumInput value={w.atHour} onChange={(e) => setWx(i, { atHour: +e.target.value })} />
                <NumInput value={w.air} onChange={(e) => setWx(i, { air: +e.target.value })} />
                <select className="aes-input" value={w.sky} onChange={(e) => setWx(i, { sky: e.target.value })}>
                  <option>Clear</option><option>Partly Cloudy</option><option>Cloudy</option><option>Light Rain</option><option>Rain</option>
                </select>
                <NumInput value={w.precip} onChange={(e) => setWx(i, { precip: +e.target.value })} />
                <NumInput value={w.wind} onChange={(e) => setWx(i, { wind: +e.target.value })} />
                <NumInput value={w.humidity} onChange={(e) => setWx(i, { humidity: +e.target.value })} />
                <button className="aes-icon-btn danger" onClick={() => delWx(i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <ResultsImport ev={ev} data={data} onImport={onImport} />

          <ResultsEditor ev={ev} data={data} onChange={onChange} onImport={onImport} />

          <div className="aes-edit-sub">
            <div className="aes-edit-sub-head"><b>Class winners (results)</b></div>
            <div className="aes-edit-grid">
              {classes.map((c) => (
                <Field key={c.id} label={c.name + " winner"}>
                  <TextInput value={ev.winners?.[c.id] || ""} placeholder="e.g. #7 Vortex Motorsport"
                    onChange={(e) => onChange({ winners: { ...(ev.winners || {}), [c.id]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </div>
          <div className="aes-edit-preview"><DayNightBar ev={ev} /></div>
        </div>
      )}
    </div>
  );
}

/* ================================ Admin gate ============================== */
function AdminGate({ data, onPass, onClose }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  const submit = () => {
    if (pin === (data.league.adminPin || "")) { onPass(); }
    else { setErr(true); setPin(""); }
  };

  return (
    <div className="aes-modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="aes-gate">
        <button className="aes-modal-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <Lock size={26} style={{ color: "var(--signal)" }} />
        <h2>Admin access</h2>
        <p>Enter the league PIN to manage events, drivers and teams.</p>
        <input
          className={"aes-input lg" + (err ? " err" : "")}
          type="password" inputMode="numeric" autoFocus
          value={pin} placeholder="••••"
          onChange={(e) => { setPin(e.target.value); if (err) setErr(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        {err && <div className="aes-err-msg">Incorrect PIN — try again.</div>}
        <button className="aes-btn primary" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} onClick={submit}>
          <Lock size={14} /> Unlock
        </button>
        <div className="aes-gate-hint">Demo PIN <b>{data.league.adminPin}</b> — change it in the League tab.</div>
      </div>
    </div>
  );
}

/* ================================== APP =================================== */
/* ============================== Track records ============================ */
function Records({ data, openDriver }) {
  const tracks = data.records || [];
  return (
    <div className="aes-page">
      <div className="aes-page-head"><h1>Track records</h1><p>Fastest race lap ever set at each circuit, by class — across all seasons</p></div>
      {tracks.length === 0 ? (
        <div className="aes-empty">No lap times recorded yet. Add best-lap times in an event's results, and records will appear here.</div>
      ) : (
        <div className="aes-rec-grid">
          {tracks.map((t) => (
            <section className="aes-card" key={t.track}>
              <div className="aes-card-head"><h2><Timer size={16} /> {t.track}</h2></div>
              {t.location && <div className="aes-rec-loc">{t.location}</div>}
              <div className="aes-rec-rows">
                {data.classes.filter((c) => t.perClass[c.id]).map((c) => {
                  const rec = t.perClass[c.id];
                  const did = (rec.driverIds || []).find((id) => data.drivers.some((d) => d.id === id));
                  return (
                    <div className="aes-rec-row" key={c.id}>
                      <span className="aes-cls-pill" style={{ color: c.color, borderColor: c.color }}>{c.name}</span>
                      <span className="aes-rec-time mono">{rec.time}</span>
                      <span className="aes-rec-who">
                        {did ? <button className="aes-link-driver" onClick={() => openDriver(did)}>{rec.drivers}</button> : rec.drivers}
                        {rec.car && <em className="aes-rec-car">{rec.car}</em>}
                      </span>
                      <span className="aes-rec-rd static">{rec.season ? rec.season.replace("Season ", "S") : ""}{rec.round ? " · R" + rec.round : ""}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ Roster / directory ========================= */
function Roster({ data, openDriver }) {
  const entriesFor = (ds) => {
    const map = {};
    ds.forEach((d) => { const k = d.cls + "#" + d.num; (map[k] = map[k] || { num: d.num, cls: d.cls, car: d.car, drivers: [] }).drivers.push(d); });
    return Object.values(map).sort((a, b) => String(a.cls).localeCompare(String(b.cls)) || (+a.num) - (+b.num));
  };
  const teamsWithD = data.teams.map((t) => ({ t, ds: data.drivers.filter((d) => d.teamId === t.id) })).filter((x) => x.ds.length);
  const unassigned = data.drivers.filter((d) => !d.teamId || !data.teams.some((t) => t.id === d.teamId));

  const Entry = ({ e }) => {
    const cls = data.classes.find((c) => c.id === e.cls);
    return (
      <div className="aes-entry">
        <span className="aes-num-badge mono">{e.num}</span>
        {cls && <span className="aes-cls-pill" style={{ color: cls.color, borderColor: cls.color }}>{cls.name}</span>}
        <div className="aes-entry-main">
          <div className="aes-entry-drivers">
            {e.drivers.map((d, i) => (
              <span key={d.id}>{i > 0 && <span className="aes-codriver-sep"> · </span>}<button className="aes-link-driver" onClick={() => openDriver(d.id)}>{d.country ? d.country + " " : ""}{d.name}</button></span>
            ))}
          </div>
          {e.car && <div className="aes-entry-car mono">{e.car}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="aes-page">
      <div className="aes-page-head"><h1>Roster</h1><p>Every team, entry and driver in {data.league.season}</p></div>
      {teamsWithD.map(({ t, ds }) => (
        <section className="aes-card" key={t.id}>
          <div className="aes-card-head"><h2><Users size={16} /> {t.name}</h2><span className="aes-roster-count">{ds.length} driver{ds.length !== 1 ? "s" : ""}</span></div>
          <div className="aes-entry-list">{entriesFor(ds).map((e) => <Entry key={e.cls + e.num} e={e} />)}</div>
        </section>
      ))}
      {unassigned.length > 0 && (
        <section className="aes-card">
          <div className="aes-card-head"><h2><Users size={16} /> Unassigned</h2></div>
          <div className="aes-entry-list">{entriesFor(unassigned).map((e) => <Entry key={e.cls + e.num} e={e} />)}</div>
        </section>
      )}
    </div>
  );
}

/* ============================== Results archive ========================== */
function ResultsArchive({ data, openEvent }) {
  const done = data.events.filter((e) => e.status === "complete" || (e.results && e.results.length)).sort((a, b) => a.round - b.round);
  return (
    <div className="aes-page">
      <div className="aes-page-head"><h1>Results</h1><p>Classified results from completed rounds</p></div>
      {done.length === 0 ? <div className="aes-empty">No completed rounds yet. Results appear here once a round is run.</div> : (
        <div className="aes-arch-list">
          {done.map((ev) => (
            <button className="aes-arch-row" key={ev.id} onClick={() => openEvent(ev.id)}>
              <span className="aes-arch-rd mono">R{ev.round}</span>
              <span className="aes-arch-main">
                <span className="aes-arch-track">{ev.track}</span>
                <span className="aes-arch-meta">{ev.location} · {fmtDate(ev.date)} · {fmtDur(durMins(ev))}</span>
              </span>
              <span className="aes-arch-win">
                {data.classes.map((c) => (ev.winners && ev.winners[c.id]) ? (
                  <span key={c.id} className="aes-arch-w"><i style={{ background: c.color }} /> {ev.winners[c.id]}</span>
                ) : null)}
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LeagueApp({ initialData }) {
  const [data] = useState(initialData);
  const [view, setView] = useState("dashboard");
  const [eventId, setEventId] = useState(null);
  const [driverId, setDriverId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const scroll = () => { if (typeof window !== "undefined") window.scrollTo(0, 0); };
  const openEvent = (id) => { setEventId(id); setView("event"); scroll(); };
  const openDriver = (id) => { setDriverId(id); setView("driver"); scroll(); };
  const go = (v) => { setView(v); setEventId(null); scroll(); };

  if (!data) {
    return (
      <div className="aes aes-loading">
        <Style />
        <div className="aes-load-inner"><div className="aes-load-flag" /><span className="mono">LOADING GRID…</span></div>
      </div>
    );
  }

  const currentEvent = data.events.find((e) => e.id === eventId);
  const currentDriver = data.drivers.find((d) => d.id === driverId);

  const NAV = [["dashboard", "Dashboard"], ["schedule", "Schedule"], ["results", "Results"], ["standings", "Championship"], ["records", "Records"], ["roster", "Roster"], ["info", "Info"]];

  return (
    <div className="aes">
      <Style />
      <header className="aes-nav">
        <button className="aes-brand" onClick={() => { go("dashboard"); setMenuOpen(false); }}>
          <img src={LOGO} alt={data.league.name} className="aes-brand-logo" />
        </button>
        {data.seasons && data.seasons.length > 0 ? (
          <select className="aes-season-sel" value={data.seasonId || ""}
            onChange={(e) => { if (typeof window !== "undefined") window.location.href = "/?season=" + e.target.value; }}>
            {data.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? " ·" : ""}</option>)}
          </select>
        ) : (
          <span className="aes-brand-season">{data.league.season}</span>
        )}
        <nav className="aes-nav-tabs">
          {NAV.map(([id, label]) => (
            <button key={id} className={view === id ? "on" : ""} onClick={() => go(id)}>{label}</button>
          ))}
        </nav>
        <button className="aes-menu-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {menuOpen && (
          <>
            <div className="aes-nav-scrim" onClick={() => setMenuOpen(false)} />
            <div className="aes-nav-drop">
              {NAV.map(([id, label]) => (
                <button key={id} className={"aes-nav-drop-item" + (view === id ? " on" : "")} onClick={() => { go(id); setMenuOpen(false); }}>{label}</button>
              ))}
            </div>
          </>
        )}
      </header>

      <main>
        {view === "dashboard" && <Dashboard data={data} openEvent={openEvent} go={go} />}
        {view === "schedule" && <Schedule data={data} openEvent={openEvent} />}
        {view === "results" && <ResultsArchive data={data} openEvent={openEvent} />}
        {view === "event" && currentEvent && <EventDetail data={data} ev={currentEvent} back={() => go("schedule")} openDriver={openDriver} />}
        {view === "standings" && <Standings data={data} openDriver={openDriver} />}
        {view === "records" && <Records data={data} openDriver={openDriver} openEvent={openEvent} />}
        {view === "roster" && <Roster data={data} openDriver={openDriver} />}
        {view === "driver" && currentDriver && <DriverProfile data={data} driver={currentDriver} back={() => go("standings")} openEvent={openEvent} />}
        {view === "info" && <Info data={data} />}
      </main>

      <footer className="aes-footer">
        <span>{data.league.name} · {data.league.tagline}</span>
        <span className="aes-footer-dim">An iRacing endurance league hub</span>
      </footer>
    </div>
  );
}

/* ================================= Styles ================================= */
function Style() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Saira:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');

.aes {
  --carbon:#0B0E14; --graphite:#10151F; --panel:#141A24; --steel:#1A2230;
  --line:#27313F; --signal:#F5EE30; --amber:#FFB627; --accent2:#37C2F0;
  --mist:#8A95A5; --mist2:#5E6878; --chalk:#E8ECF2; --green:#5BD6A0;
  --disp:'Saira Condensed',sans-serif; --body:'Saira',sans-serif; --mono:'JetBrains Mono',monospace;
  background:var(--carbon); color:var(--chalk); font-family:var(--body);
  min-height:100vh; font-size:15px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.aes *,.aes *::before,.aes *::after{ box-sizing:border-box; }
.aes .mono{ font-family:var(--mono); font-variant-numeric:tabular-nums; }
.aes button{ font-family:var(--body); cursor:pointer; }
.aes a{ color:inherit; text-decoration:none; }
.aes h1,.aes h2{ font-family:var(--disp); letter-spacing:.01em; margin:0; }
.aes :focus-visible{ outline:2px solid var(--accent2); outline-offset:2px; border-radius:3px; }

/* loading */
.aes-loading{ display:grid; place-items:center; height:100vh; }
.aes-load-inner{ display:flex; flex-direction:column; align-items:center; gap:14px; color:var(--mist); letter-spacing:.25em; font-size:13px; }
.aes-load-flag{ width:42px; height:42px; border-radius:6px; background:repeating-linear-gradient(45deg,#1a2230 0 8px,#0d1119 8px 16px); animation:aes-pulse 1.1s infinite; }
@keyframes aes-pulse{ 0%,100%{opacity:.35} 50%{opacity:1} }

/* nav */
.aes-nav{ position:sticky; top:0; z-index:40; display:flex; align-items:center; gap:18px;
  padding:0 24px; height:60px; background:rgba(11,14,20,.86); backdrop-filter:blur(10px);
  border-bottom:1px solid var(--line); }
.aes-brand{ display:flex; align-items:center; gap:11px; background:none; border:none; padding:0; }
.aes-brand-mark{ width:11px; height:26px; background:var(--signal); border-radius:1px;
  box-shadow:6px 0 0 -1px var(--steel), 12px 0 0 -1px var(--accent2); }
.aes-brand-text{ display:flex; flex-direction:column; align-items:flex-start; font-family:var(--disp);
  font-weight:700; font-size:18px; line-height:1; letter-spacing:.03em; color:var(--chalk); }
.aes-brand-text em{ font-family:var(--mono); font-style:normal; font-size:10px; font-weight:500;
  letter-spacing:.18em; color:var(--signal); margin-top:3px; }
.aes-brand-logo{ height:26px; width:auto; display:block; }
.aes-brand-season{ font-family:var(--mono); font-size:10px; font-weight:500; letter-spacing:.18em; color:var(--signal); border:1px solid var(--line); border-radius:5px; padding:2px 7px; }
.aes-season-sel{ background:var(--graphite); border:1px solid var(--line); color:var(--signal); font-family:var(--mono);
  font-size:11px; font-weight:600; letter-spacing:.1em; padding:5px 9px; border-radius:6px; cursor:pointer; }
.aes-season-sel:hover{ border-color:var(--signal); }
.aes-rec-rd.static{ background:none; border:none; color:var(--mist); cursor:default; font-family:var(--mono); font-size:11px; }
.aes-nav-tabs{ display:flex; gap:4px; margin-left:auto; }
.aes-nav-tabs button{ background:none; border:none; color:var(--mist); font-size:14px; font-weight:600;
  padding:8px 13px; border-radius:7px; letter-spacing:.02em; }
.aes-nav-tabs button:hover{ color:var(--chalk); background:var(--steel); }
.aes-nav-tabs button.on{ color:var(--chalk); background:var(--steel); box-shadow:inset 0 -2px 0 var(--signal); }
.aes-admin-btn{ display:flex; align-items:center; gap:6px; background:none; border:1px solid var(--line);
  color:var(--mist); font-size:12px; font-weight:600; padding:7px 12px; border-radius:7px; letter-spacing:.04em; }
.aes-admin-btn:hover{ border-color:var(--signal); color:var(--chalk); }
.aes-menu-btn{ display:none; align-items:center; justify-content:center; margin-left:auto; background:none;
  border:1px solid var(--line); color:var(--chalk); width:38px; height:38px; border-radius:8px; cursor:pointer; }
.aes-menu-btn:hover{ border-color:var(--signal); }
.aes-nav-scrim{ position:fixed; inset:60px 0 0 0; background:rgba(5,7,11,.5); z-index:38; }
.aes-nav-drop{ position:absolute; top:100%; left:0; right:0; z-index:39; display:flex; flex-direction:column;
  padding:8px; gap:2px; background:var(--graphite); border-bottom:1px solid var(--line); box-shadow:0 18px 40px rgba(0,0,0,.5); }
.aes-nav-drop-item{ text-align:left; background:none; border:none; color:var(--mist); font-size:15px; font-weight:600;
  padding:12px 14px; border-radius:8px; display:flex; align-items:center; gap:8px; cursor:pointer; }
.aes-nav-drop-item:hover{ background:var(--steel); color:var(--chalk); }
.aes-nav-drop-item.on{ color:var(--chalk); background:var(--steel); box-shadow:inset 3px 0 0 var(--signal); }
.aes-nav-drop-item.admin{ margin-top:5px; padding-top:14px; border-top:1px solid var(--line); color:var(--chalk); }
@media (min-width:901px){ .aes-nav-drop, .aes-nav-scrim, .aes-menu-btn{ display:none !important; } }
@media (max-width:900px){
  .aes-nav-tabs{ display:none; }
  .aes-admin-btn{ display:none; }
  .aes-menu-btn{ display:flex; }
}

main{ max-width:1080px; margin:0 auto; padding:0 24px; }
.aes-page{ padding:30px 0 60px; display:flex; flex-direction:column; gap:22px; }
.aes-page-head h1{ font-size:34px; font-weight:700; letter-spacing:.01em; }
.aes-page-head p{ margin:4px 0 0; color:var(--mist); font-size:14px; }

/* generic card */
.aes-card{ background:var(--graphite); border:1px solid var(--line); border-radius:14px; padding:20px; }
.aes-card-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.aes-card-head h2{ display:flex; align-items:center; gap:8px; font-size:16px; font-weight:600;
  letter-spacing:.06em; text-transform:uppercase; color:var(--chalk); }
.aes-card-head h2 svg{ color:var(--signal); }
.aes-section-label{ display:flex; align-items:center; gap:6px; font-family:var(--mono); font-size:11px;
  letter-spacing:.16em; text-transform:uppercase; color:var(--mist); margin-bottom:10px; }
.aes-section-label svg{ color:var(--amber); }
.aes-split{ display:grid; grid-template-columns:1fr 1fr; gap:22px; }
.aes-link{ display:inline-flex; align-items:center; gap:3px; background:none; border:none;
  color:var(--accent2); font-size:13px; font-weight:600; }
.aes-link:hover{ text-decoration:underline; }

/* buttons */
.aes-btn{ display:inline-flex; align-items:center; gap:7px; border-radius:8px; font-weight:600;
  font-size:14px; padding:10px 16px; border:1px solid transparent; }
.aes-btn.primary{ background:var(--signal); color:#141200; }
.aes-btn.primary:hover{ filter:brightness(1.08); }
.aes-btn.ghost{ background:var(--steel); color:var(--chalk); border-color:var(--line); }
.aes-btn.ghost:hover{ border-color:var(--mist2); }
.aes-btn.block{ width:100%; justify-content:center; }
.aes-btn.sm{ padding:7px 12px; font-size:13px; }
.aes-btn.xs{ padding:4px 9px; font-size:12px; }

/* hero */
.aes-hero{ background:linear-gradient(160deg,#141C28,#0D1119); border:1px solid var(--line);
  border-radius:16px; padding:26px; position:relative; overflow:hidden; }
.aes-hero::before{ content:""; position:absolute; inset:0; background:
  radial-gradient(700px 280px at 88% -20%, rgba(245,238,48,.15), transparent 60%); pointer-events:none; }
.aes-hero-tag{ position:relative; display:inline-flex; align-items:center; gap:7px; font-family:var(--mono);
  font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--signal); margin-bottom:14px; }
.aes-hero-grid{ position:relative; display:grid; grid-template-columns:1fr auto; gap:24px; align-items:center; }
.aes-hero-round{ font-size:13px; color:var(--mist); letter-spacing:.2em; }
.aes-hero-track{ font-size:42px; font-weight:700; line-height:1.02; margin:4px 0 14px; }
.aes-hero-sub{ display:flex; flex-wrap:wrap; gap:18px; color:var(--mist); font-size:14px; margin-bottom:18px; }
.aes-hero-sub span{ display:inline-flex; align-items:center; gap:6px; }
.aes-hero-sub svg{ color:var(--mist2); }
.aes-countdown{ background:rgba(0,0,0,.28); border:1px solid var(--line); border-radius:12px; padding:16px 18px; }
.aes-cd-label{ font-family:var(--mono); font-size:10px; letter-spacing:.2em; text-transform:uppercase; color:var(--mist); text-align:center; margin-bottom:10px; }
.aes-cd-row{ display:flex; gap:10px; }
.aes-cd-cell{ text-align:center; min-width:54px; }
.aes-cd-num{ font-size:34px; font-weight:700; line-height:1; color:var(--chalk); }
.aes-cd-unit{ font-family:var(--mono); font-size:9px; letter-spacing:.18em; color:var(--mist2); margin-top:5px; }
.aes-hero-dn{ position:relative; margin-top:22px; }

/* day-night bar */
.aes-dn{ width:100%; }
.aes-dn-bar{ position:relative; height:34px; border-radius:7px; border:1px solid var(--line);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.03); }
.aes-dn.compact .aes-dn-bar{ height:18px; }
.aes-dn-sun{ position:absolute; top:50%; transform:translate(-50%,-50%); color:rgba(255,255,255,.92);
  filter:drop-shadow(0 0 4px rgba(0,0,0,.5)); }
.aes-dn-ends{ display:flex; justify-content:space-between; align-items:center; margin-top:7px;
  font-size:11px; color:var(--mist); }
.aes-dn-ends em{ font-style:normal; color:var(--mist2); }
.aes-dn-mid{ font-family:var(--mono); font-size:10px; letter-spacing:.08em; color:var(--mist2); }
.aes-dn-ticks{ position:relative; height:14px; margin-top:2px; }
.aes-dn-tick{ position:absolute; transform:translateX(-50%); font-size:9.5px; color:var(--mist2); }
.aes-dn.compact .aes-dn-ends{ font-size:10px; }

/* weather */
.aes-wx-strip{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
.aes-wx{ background:var(--panel); border:1px solid var(--line); border-radius:11px; padding:13px 14px; }
.aes-wx-top{ display:flex; align-items:center; justify-content:space-between; }
.aes-wx-hr{ font-size:11px; color:var(--mist); }
.aes-wx-sky{ font-weight:600; font-size:14px; margin:7px 0 9px; }
.aes-wx-rows{ display:grid; gap:5px; }
.aes-wx-rows span{ display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--mist); font-family:var(--mono); }
.aes-wx-rows svg{ color:var(--mist2); flex-shrink:0; }

/* leaders */
.aes-leader-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:22px; }
.aes-leader-cls{ font-family:var(--disp); font-weight:700; font-size:15px; letter-spacing:.1em;
  border-left:3px solid; padding-left:9px; margin-bottom:11px; }
.aes-leader-row{ display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid var(--line); }
.aes-pos{ width:18px; color:var(--mist2); font-size:13px; }
.aes-flag{ font-size:16px; }
.aes-leader-name{ display:flex; flex-direction:column; font-weight:600; font-size:14px; flex:1; }
.aes-leader-name em{ font-style:normal; font-weight:400; font-size:11.5px; color:var(--mist); margin-top:1px; }
.aes-leader-pts{ font-size:17px; font-weight:700; color:var(--chalk); }

/* progress */
.aes-progress-bar{ height:8px; background:var(--steel); border-radius:4px; overflow:hidden; }
.aes-progress-fill{ height:100%; background:linear-gradient(90deg,var(--signal),var(--amber)); }
.aes-progress-meta{ font-size:11px; color:var(--mist); margin-top:8px; letter-spacing:.08em; }
.aes-mini-sched{ display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
.aes-mini-round{ display:flex; flex-direction:column; gap:2px; align-items:center; background:var(--panel);
  border:1px solid var(--line); border-radius:8px; padding:8px 11px; font-size:12px; color:var(--mist); min-width:64px; }
.aes-mini-round span:first-child{ font-family:var(--mono); font-size:11px; color:var(--mist2); }
.aes-mini-round span:last-child{ color:var(--chalk); font-weight:600; }
.aes-mini-round:hover{ border-color:var(--mist2); }
.aes-mini-round.complete{ border-left:3px solid var(--green); }
.aes-mini-round.next{ border-left:3px solid var(--signal); }

/* results */
.aes-result-row{ display:flex; align-items:center; gap:14px; padding:11px 0; border-top:1px solid var(--line); }
.aes-result-row:first-child{ border-top:none; }
.aes-cls-pill{ font-family:var(--mono); font-size:11px; letter-spacing:.08em; border:1px solid; border-radius:5px; padding:3px 8px; }
.aes-result-win{ font-weight:600; }

/* schedule timeline */
.aes-timeline{ display:flex; flex-direction:column; gap:12px; }
.aes-tl-row{ display:grid; grid-template-columns:90px 1fr 200px 200px 24px; gap:18px; align-items:center;
  background:var(--graphite); border:1px solid var(--line); border-radius:12px; padding:16px 18px; text-align:left;
  width:100%; transition:border-color .15s,transform .15s; }
.aes-tl-row:hover{ border-color:var(--mist2); transform:translateX(2px); }
.aes-tl-row.next{ border-left:3px solid var(--signal); }
.aes-tl-row.complete{ opacity:.82; }
.aes-tl-round{ display:flex; flex-direction:column; gap:7px; }
.aes-tl-round>span:first-child{ font-family:var(--disp); font-weight:700; font-size:20px; color:var(--chalk); }
.aes-tl-track{ font-weight:600; font-size:16px; }
.aes-tl-loc{ display:flex; align-items:center; gap:5px; color:var(--mist); font-size:12.5px; margin-top:3px; }
.aes-tl-meta{ display:flex; flex-direction:column; gap:5px; font-size:12.5px; color:var(--mist); }
.aes-tl-meta span{ display:flex; align-items:center; gap:6px; }
.aes-tl-meta svg{ color:var(--mist2); }
.aes-tl-arrow{ color:var(--mist2); justify-self:end; }

/* chips */
.aes-chip{ display:inline-flex; align-items:center; gap:4px; font-family:var(--mono); font-size:10.5px;
  letter-spacing:.06em; border:1px solid; border-radius:5px; padding:2px 7px; }
.aes-cls{ display:inline-flex; font-family:var(--mono); font-size:10.5px; font-weight:700; letter-spacing:.05em;
  border:1px solid; border-radius:4px; padding:1px 6px; margin:0 2px; }

/* back */
.aes-back{ display:inline-flex; align-items:center; gap:6px; background:none; border:none; color:var(--mist);
  font-weight:600; font-size:13px; padding:0; align-self:flex-start; }
.aes-back:hover{ color:var(--chalk); }

/* event detail */
.aes-event-hero{ background:linear-gradient(160deg,#141C28,#0D1119); border:1px solid var(--line);
  border-radius:16px; padding:26px; }
.aes-event-top{ display:flex; align-items:center; gap:12px; margin-bottom:8px; }
.aes-event-cd{ margin-top:16px; font-size:22px; font-weight:700; color:var(--signal); letter-spacing:.04em; }
.aes-event-cd span{ font-family:var(--body); font-size:12px; color:var(--mist); font-weight:500; margin-left:8px; letter-spacing:.04em; }

/* sessions */
.aes-sessions{ display:flex; flex-direction:column; gap:8px; }
.aes-session{ display:grid; grid-template-columns:110px 1fr auto; gap:12px; align-items:center;
  background:var(--panel); border:1px solid var(--line); border-radius:9px; padding:11px 14px; }
.aes-session.race{ border-color:var(--signal); background:rgba(245,238,48,.07); }
.aes-session-type{ font-family:var(--disp); font-weight:600; font-size:15px; letter-spacing:.04em; }
.aes-session.race .aes-session-type{ color:var(--signal); }
.aes-session-time{ font-size:12.5px; color:var(--mist); }
.aes-session-dur{ font-size:13px; color:var(--chalk); font-weight:500; }
.aes-format{ display:flex; flex-wrap:wrap; gap:18px; margin-top:14px; color:var(--mist); font-size:13px; }
.aes-format span{ display:inline-flex; align-items:center; gap:7px; }
.aes-format svg{ color:var(--mist2); }
.aes-notes{ margin:0; color:var(--mist); font-size:14.5px; line-height:1.65; }

/* standings controls + table */
.aes-controls{ display:flex; flex-wrap:wrap; gap:12px; align-items:center; }
.aes-toggle{ display:inline-flex; background:var(--graphite); border:1px solid var(--line); border-radius:9px; padding:3px; gap:2px; }
.aes-toggle button{ background:none; border:none; color:var(--mist); font-weight:600; font-size:13px; padding:7px 15px; border-radius:7px; letter-spacing:.02em; }
.aes-toggle button:hover{ color:var(--chalk); }
.aes-toggle button.on{ background:var(--steel); color:var(--chalk); }
.aes-table-wrap{ overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--graphite); }
.aes-table{ width:100%; border-collapse:collapse; font-size:14px; min-width:560px; }
.aes-table th{ text-align:left; font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--mist); font-weight:500; padding:13px 14px; border-bottom:1px solid var(--line); background:var(--panel); }
.aes-table td{ padding:12px 14px; border-bottom:1px solid var(--line); }
.aes-table tr:last-child td{ border-bottom:none; }
.aes-table tbody tr:hover{ background:rgba(255,255,255,.02); }
.aes-table .num{ width:42px; }
.aes-table .ctr{ text-align:center; }
.aes-table .rnd{ width:44px; }
.aes-table td.num{ color:var(--mist2); font-size:13px; }
.aes-table td.pts{ font-size:16px; font-weight:700; color:var(--chalk); }
.aes-table td.dim{ color:var(--mist); }
.aes-td-driver{ font-weight:600; }
.aes-driver-car{ font-family:var(--mono); font-size:11px; color:var(--mist2); margin-top:3px; font-weight:400; }
.aes-td-team{ color:var(--mist); font-size:13px; }
.aes-num-badge{ display:inline-block; font-size:11px; color:var(--carbon); background:var(--mist);
  border-radius:4px; padding:1px 5px; margin:0 4px; font-weight:700; }
.aes-table tbody tr:nth-child(1) td.pts{ color:var(--amber); }

/* chart */
.aes-chart{ margin-top:4px; }
.aes-chart-legend{ display:flex; flex-wrap:wrap; gap:16px; margin-top:12px; font-family:var(--mono); font-size:12px; color:var(--mist); }
.aes-chart-legend span{ display:flex; align-items:center; gap:6px; }
.aes-chart-legend i{ width:14px; height:3px; border-radius:2px; display:inline-block; }

/* info */
.aes-info-grid{ display:grid; grid-template-columns:1fr 1fr; gap:16px 28px; }
.aes-info-grid dt{ font-family:var(--mono); font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist); }
.aes-info-grid dd{ margin:3px 0 0; font-weight:500; }
.aes-rules{ margin:0; padding-left:18px; display:flex; flex-direction:column; gap:9px; color:var(--mist); font-size:14px; line-height:1.55; }
.aes-rules li::marker{ color:var(--signal); }
.aes-links{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; }
.aes-link-card{ display:flex; align-items:center; gap:13px; background:var(--panel); border:1px solid var(--line);
  border-radius:11px; padding:15px 16px; }
.aes-link-card:hover{ border-color:var(--signal); }
.aes-link-card svg{ color:var(--signal); }
.aes-link-card span{ display:flex; flex-direction:column; font-weight:600; }
.aes-link-card em{ font-style:normal; font-weight:400; font-size:12px; color:var(--mist); margin-top:2px; }

/* footer */
.aes-footer{ border-top:1px solid var(--line); margin-top:20px; padding:22px 24px; max-width:1080px;
  margin-left:auto; margin-right:auto; display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;
  color:var(--mist); font-size:12.5px; }
.aes-footer-dim{ color:var(--mist2); font-family:var(--mono); letter-spacing:.06em; }

/* modal / gate */
.aes-modal-bg{ position:fixed; inset:0; z-index:60; background:rgba(5,7,11,.78); backdrop-filter:blur(4px);
  display:grid; place-items:center; padding:20px; }
.aes-gate{ position:relative; width:100%; max-width:360px; background:var(--graphite); border:1px solid var(--line);
  border-radius:16px; padding:30px 26px; text-align:center; }
.aes-gate h2{ font-size:22px; font-weight:700; margin:14px 0 6px; }
.aes-gate p{ color:var(--mist); font-size:13.5px; margin:0 0 18px; }
.aes-modal-x{ position:absolute; top:14px; right:14px; background:none; border:none; color:var(--mist); }
.aes-modal-x:hover{ color:var(--chalk); }
.aes-err-msg{ color:var(--signal); font-size:12.5px; margin:8px 0; }
.aes-gate-hint{ margin-top:16px; font-size:11.5px; color:var(--mist2); }
.aes-gate-hint b{ color:var(--amber); }

/* results import + classified tables */
.aes-drop{ border:1.5px dashed var(--line); border-radius:12px; padding:22px 18px; text-align:center; cursor:pointer;
  transition:border-color .15s, background .15s, color .15s; color:var(--mist); background:var(--carbon); }
.aes-drop:hover,.aes-drop.over{ border-color:var(--signal); color:var(--chalk); background:rgba(245,238,48,.05); }
.aes-drop>svg{ color:var(--signal); }
.aes-drop-title{ font-weight:600; color:var(--chalk); margin-top:8px; font-size:14px; }
.aes-drop-sub{ font-size:12px; margin-top:3px; color:var(--mist); }
.aes-spin{ animation:aes-spin .9s linear infinite; }
@keyframes aes-spin{ to{ transform:rotate(360deg); } }
.aes-import-err{ display:flex; align-items:center; gap:6px; color:var(--signal); font-size:12.5px; margin-top:9px; }
.aes-import-err svg{ flex:none; }
.aes-import-note{ font-size:12px; color:var(--mist); margin:4px 0 10px; line-height:1.45; }
.aes-import-actions{ display:flex; gap:8px; margin-top:10px; }
.aes-import-done{ display:flex; align-items:center; gap:8px; color:var(--green); font-size:13px; font-weight:600; line-height:1.4; }
.aes-rt-wrap{ max-height:300px; overflow:auto; border:1px solid var(--line); border-radius:9px; }
.aes-results-table{ width:100%; min-width:540px; border-collapse:collapse; font-size:13px; }
.aes-results-table th{ position:sticky; top:0; background:var(--graphite); text-align:left; font-family:var(--mono);
  font-size:9.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--mist); padding:7px 9px; border-bottom:1px solid var(--line); }
.aes-results-table td{ padding:6px 9px; border-bottom:1px solid var(--steel); vertical-align:middle; }
.aes-results-table tr:last-child td{ border-bottom:none; }
.aes-results-table .dim{ color:var(--mist); }
.aes-results-table .pts{ color:var(--signal); font-weight:600; }
.aes-results-pos{ font-family:var(--mono); color:var(--chalk); font-weight:600; }
.aes-results-table tr.unmatched td{ background:rgba(255,182,39,.06); }
.aes-rt-nomatch{ color:var(--amber); font-size:11.5px; font-family:var(--mono); }
.aes-rt-match{ font-size:12px; }
.aes-rt-pts{ width:66px; padding:5px 7px; text-align:center; font-family:var(--mono); }
.aes-points-edit{ margin-top:14px; display:flex; flex-direction:column; gap:6px; }
.aes-field-label{ font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist); }
.aes-points-hint{ font-size:11.5px; color:var(--mist2); line-height:1.45; }
.aes-cr-block{ margin-top:14px; }
.aes-cr-block:first-of-type{ margin-top:4px; }
.aes-cr-clshead{ margin-bottom:7px; }

/* clickable driver links */
.aes-link-driver{ background:none; border:none; padding:0; color:inherit; font:inherit; cursor:pointer;
  border-bottom:1px dotted var(--mist2); transition:color .12s, border-color .12s; }
.aes-link-driver:hover{ color:var(--signal); border-bottom-color:var(--signal); }
.aes-rt-car{ font-size:12px; white-space:nowrap; }
.aes-laps-toggle{ display:flex; align-items:flex-start; gap:8px; margin-top:10px; font-size:12px; color:var(--mist); line-height:1.4; cursor:pointer; }
.aes-laps-toggle input{ margin-top:2px; accent-color:var(--signal); }

/* driver profile */
.aes-prof-head{ display:flex; align-items:center; gap:18px; margin-bottom:18px; }
.aes-prof-num{ font-size:46px; font-weight:700; color:var(--signal); line-height:1; min-width:54px; }
.aes-prof-name{ font-size:30px; font-weight:700; display:flex; align-items:center; gap:10px; }
.aes-prof-name .aes-flag{ font-size:26px; }
.aes-prof-meta{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:8px; }
.aes-prof-team{ color:var(--chalk); font-weight:600; font-size:14px; }
.aes-prof-car{ color:var(--mist); font-size:12.5px; }
.aes-prof-stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(108px,1fr)); gap:10px; margin-bottom:22px; }
.aes-stat{ background:var(--graphite); border:1px solid var(--line); border-radius:11px; padding:14px 12px; display:flex; flex-direction:column; gap:5px; align-items:flex-start; }
.aes-stat-v{ font-size:22px; font-weight:700; color:var(--chalk); }
.aes-stat-k{ font-family:var(--mono); font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--mist); }
.aes-chart{ margin-top:6px; }
.aes-card-head-row{ display:flex; align-items:center; justify-content:space-between; gap:12px; }
.aes-lap-sel{ width:auto; min-width:140px; padding:6px 9px; font-size:12.5px; }
.aes-lap-note{ font-size:11.5px; color:var(--mist2); margin-top:8px; }
.aes-empty{ text-align:center; color:var(--mist); font-size:14px; padding:40px 20px; border:1px dashed var(--line); border-radius:12px; }

/* live broadcast */
.aes-cast-frame{ position:relative; padding-top:56.25%; border-radius:10px; overflow:hidden; background:#000; }
.aes-cast-frame iframe{ position:absolute; inset:0; width:100%; height:100%; border:0; }
.aes-cast-link{ display:flex; align-items:center; justify-content:center; gap:9px; padding:20px; border:1px dashed var(--line);
  border-radius:10px; color:var(--chalk); font-weight:600; font-size:14px; }
.aes-cast-link:hover{ border-color:var(--signal); color:var(--signal); }
.aes-cast-link svg{ color:var(--signal); }

/* track records */
.aes-rec-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:14px; }
.aes-rec-loc{ color:var(--mist); font-size:12.5px; margin:-4px 0 10px; }
.aes-rec-rows{ display:flex; flex-direction:column; gap:8px; }
.aes-rec-row{ display:grid; grid-template-columns:auto 96px 1fr auto; align-items:center; gap:10px; padding:9px 10px;
  background:var(--graphite); border:1px solid var(--line); border-radius:9px; }
.aes-rec-time{ font-size:15px; font-weight:700; color:var(--chalk); }
.aes-rec-who{ display:flex; flex-direction:column; gap:1px; min-width:0; font-size:13px; }
.aes-rec-car{ font-style:normal; font-family:var(--mono); font-size:11px; color:var(--mist2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aes-rec-rd{ background:var(--steel); border:1px solid var(--line); color:var(--mist); font-family:var(--mono); font-size:11px;
  padding:3px 8px; border-radius:6px; cursor:pointer; }
.aes-rec-rd:hover{ color:var(--signal); border-color:var(--signal); }
.aes-pen{ color:var(--amber); font-size:11px; font-weight:600; }

/* roster / directory */
.aes-roster-count{ font-family:var(--mono); font-size:11px; color:var(--mist); }
.aes-entry-list{ display:flex; flex-direction:column; gap:8px; }
.aes-entry{ display:flex; align-items:center; gap:11px; padding:9px 11px; background:var(--graphite); border:1px solid var(--line); border-radius:9px; }
.aes-entry-main{ display:flex; flex-direction:column; gap:2px; min-width:0; }
.aes-entry-drivers{ font-size:14px; font-weight:600; color:var(--chalk); }
.aes-entry-car{ font-size:11px; color:var(--mist2); }
.aes-codriver-sep{ color:var(--mist2); }

/* results archive */
.aes-arch-list{ display:flex; flex-direction:column; gap:8px; }
.aes-arch-row{ display:flex; align-items:center; gap:14px; width:100%; text-align:left; padding:13px 15px; background:var(--graphite);
  border:1px solid var(--line); border-radius:11px; cursor:pointer; transition:border-color .12s, background .12s; }
.aes-arch-row:hover{ border-color:var(--signal); background:var(--panel); }
.aes-arch-row>svg{ color:var(--mist); flex:none; margin-left:auto; }
.aes-arch-rd{ font-size:16px; font-weight:700; color:var(--signal); flex:none; width:38px; }
.aes-arch-main{ display:flex; flex-direction:column; gap:2px; min-width:0; flex:none; width:210px; }
.aes-arch-track{ font-weight:600; color:var(--chalk); font-size:14px; }
.aes-arch-meta{ font-size:11.5px; color:var(--mist); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aes-arch-win{ display:flex; flex-wrap:wrap; gap:4px 12px; flex:1; min-width:0; }
.aes-arch-w{ display:flex; align-items:center; gap:6px; font-size:12px; color:var(--mist); white-space:nowrap; }
.aes-arch-w i{ width:8px; height:8px; border-radius:2px; flex:none; }
@media (max-width:720px){
  .aes-arch-win{ display:none; }
  .aes-arch-main{ width:auto; flex:1; }
}
@media (max-width:720px){
  .aes-prof-stats{ grid-template-columns:repeat(2,1fr); }
  .aes-prof-num{ font-size:38px; }
  .aes-prof-name{ font-size:24px; }
}

/* inputs */
.aes-input{ width:100%; background:var(--carbon); border:1px solid var(--line); color:var(--chalk);
  border-radius:8px; padding:9px 11px; font-family:var(--body); font-size:14px; }
.aes-input:focus{ border-color:var(--accent2); outline:none; }
.aes-input.lg{ font-size:22px; text-align:center; letter-spacing:.4em; padding:13px; font-family:var(--mono); margin-bottom:6px; }
.aes-input.err{ border-color:var(--signal); }
textarea.aes-input{ resize:vertical; font-family:var(--body); }
.aes-field{ display:flex; flex-direction:column; gap:5px; }
.aes-field>span{ font-family:var(--mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist); }

/* admin */
.aes-admin{ max-width:1080px; margin:0 auto; padding:0 24px 60px; }
.aes-admin-top{ position:sticky; top:0; z-index:30; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  padding:16px 0; background:var(--carbon); border-bottom:1px solid var(--line); margin-bottom:18px; }
.aes-admin-title{ display:flex; align-items:center; gap:9px; font-family:var(--disp); font-weight:700; font-size:20px; }
.aes-admin-title svg{ color:var(--signal); }
.aes-admin-mode{ font-family:var(--mono); font-size:9px; letter-spacing:.2em; background:var(--signal); color:#141200;
  padding:2px 6px; border-radius:4px; align-self:center; }
.aes-admin-actions{ display:flex; gap:8px; flex-wrap:wrap; margin-left:auto; align-items:center; }
.aes-saved{ display:flex; align-items:center; gap:5px; color:var(--green); font-size:12.5px; font-weight:600; }
.aes-warn-pill{ font-family:var(--mono); font-size:10px; letter-spacing:.06em; color:var(--amber);
  border:1px solid var(--amber); border-radius:5px; padding:3px 7px; }
.aes-admin-tabs{ display:flex; gap:4px; margin-bottom:20px; flex-wrap:wrap; }
.aes-admin-tabs button{ background:var(--graphite); border:1px solid var(--line); color:var(--mist);
  font-weight:600; font-size:13px; padding:9px 16px; border-radius:8px; }
.aes-admin-tabs button.on{ background:var(--steel); color:var(--chalk); border-color:var(--mist2); }
.aes-admin-addbar{ margin-bottom:14px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.aes-filter{ display:flex; align-items:center; gap:7px; background:var(--graphite); border:1px solid var(--line);
  border-radius:8px; padding:0 10px; flex:1; min-width:200px; }
.aes-filter>svg{ color:var(--mist); flex:none; }
.aes-filter-input{ background:none; border:none; color:var(--chalk); font-family:var(--body); font-size:13.5px; padding:8px 0; flex:1; outline:none; min-width:60px; }
.aes-filter-input::placeholder{ color:var(--mist2); }
.aes-filter-cls{ width:auto; min-width:130px; padding:8px 10px; font-size:13px; flex:none; }
.aes-filter-empty{ color:var(--mist); font-size:13px; padding:18px 8px; text-align:center; }
.aes-res-scroll{ overflow-x:auto; border:1px solid var(--line); border-radius:9px; margin-top:4px; }
.aes-res-grid{ min-width:1000px; }
.aes-res-head,.aes-res-row{ display:grid; grid-template-columns:48px 86px 52px 1.5fr 1.4fr 56px 56px 96px 48px 96px 64px 56px 32px; gap:6px; align-items:center; padding:6px 8px; }
.aes-res-head{ position:sticky; top:0; background:var(--graphite); font-family:var(--mono); font-size:9px; letter-spacing:.05em; text-transform:uppercase; color:var(--mist); border-bottom:1px solid var(--line); }
.aes-res-row{ border-bottom:1px solid var(--steel); }
.aes-res-row:last-child{ border-bottom:none; }
.aes-res-grid .aes-input{ padding:6px 7px; font-size:12.5px; }
.aes-res-grid .aes-icon-btn{ justify-self:center; }
.aes-admin-body{ display:flex; flex-direction:column; gap:12px; }
.aes-hint{ color:var(--mist2); font-size:12.5px; margin:4px 0 0; }

.aes-edit-card{ background:var(--graphite); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.aes-edit-card-head{ display:flex; align-items:center; gap:12px; padding:14px 16px; cursor:pointer; }
.aes-edit-card-head:hover{ background:rgba(255,255,255,.02); }
.aes-edit-round{ font-family:var(--disp); font-weight:700; font-size:17px; color:var(--mist); }
.aes-edit-track{ font-weight:600; font-size:15px; }
.aes-edit-spacer{ flex:1; }
.aes-edit-chev{ color:var(--mist2); transition:transform .2s; }
.aes-edit-chev.open{ transform:rotate(90deg); }
.aes-edit-card-body{ padding:4px 16px 18px; display:flex; flex-direction:column; gap:16px; border-top:1px solid var(--line); }
.aes-edit-grid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:13px; margin-top:14px; }
.aes-edit-sub{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:13px; }
.aes-edit-sub-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:11px; font-size:13px; letter-spacing:.04em; }
.aes-edit-srow{ display:grid; grid-template-columns:130px 1fr 90px 36px; gap:8px; margin-bottom:8px; }
.aes-edit-wrow{ display:grid; grid-template-columns:repeat(2,1fr) 1.5fr repeat(3,1fr) 36px; gap:6px; margin-bottom:7px; }
.aes-wx-edit-head{ display:grid; grid-template-columns:repeat(2,1fr) 1.5fr repeat(3,1fr) 36px; gap:6px;
  font-size:11px; letter-spacing:.01em; color:var(--mist); font-weight:600; margin-bottom:7px; padding:0 2px; line-height:1.2; align-items:end; }
.aes-edit-preview{ padding-top:4px; }

.aes-edit-list{ display:flex; flex-direction:column; gap:8px; }
.aes-edit-row{ display:grid; gap:8px; align-items:center; background:var(--graphite); border:1px solid var(--line);
  border-radius:10px; padding:10px 12px; }
.aes-edit-row.driver{ grid-template-columns:50px 1.3fr 140px 1fr 78px 1.25fr 56px auto; }
.aes-edit-row.team{ grid-template-columns:1fr auto auto; }
.aes-edit-row.head{ background:none; border:none; padding:2px 12px 0; align-items:end; }
.aes-edit-row.head span{ font-family:var(--mono); font-size:9.5px; letter-spacing:.07em; text-transform:uppercase; color:var(--mist2); }
.aes-edit-actions{ display:flex; gap:6px; justify-content:flex-end; }
.aes-cs{ position:relative; }
.aes-cs-field{ display:flex; align-items:center; gap:7px; background:var(--carbon); border:1px solid var(--line); border-radius:8px; padding:0 10px; }
.aes-cs-field:focus-within{ border-color:var(--accent2); }
.aes-cs-flag{ font-size:17px; line-height:1; }
.aes-cs-field input{ flex:1; min-width:0; background:none; border:none; color:var(--chalk); font-family:var(--body); font-size:14px; padding:9px 0; outline:none; }
.aes-cs-menu{ position:absolute; top:calc(100% + 4px); left:0; min-width:230px; z-index:50; background:var(--graphite); border:1px solid var(--line); border-radius:10px; padding:5px; max-height:260px; overflow-y:auto; box-shadow:0 12px 34px rgba(0,0,0,.5); }
.aes-cs-opt{ display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:none; border:none; color:var(--chalk); font-size:13.5px; padding:8px 10px; border-radius:7px; }
.aes-cs-opt:hover{ background:var(--steel); }
.aes-cs-opt span{ font-size:17px; }
.aes-edit-total{ text-align:center; font-weight:700; color:var(--amber); }
.aes-edit-meta{ color:var(--mist); font-size:12.5px; }
.aes-icon-btn{ display:grid; place-items:center; background:var(--steel); border:1px solid var(--line);
  border-radius:7px; width:34px; height:34px; color:var(--mist); }
.aes-icon-btn:hover{ color:var(--chalk); }
.aes-icon-btn.danger:hover{ color:var(--signal); border-color:var(--signal); }
.aes-icon-btn:disabled{ opacity:.35; cursor:not-allowed; }

@media (max-width:820px){
  .aes-split,.aes-leader-grid,.aes-hero-grid,.aes-info-grid{ grid-template-columns:1fr; }
  .aes-hero{ padding:20px; }
  .aes-hero-track{ font-size:32px; }
  .aes-countdown{ width:100%; }
  .aes-cd-row{ justify-content:space-between; }
  .aes-tl-row{ grid-template-columns:1fr; gap:12px; }
  .aes-tl-meta{ flex-direction:row; flex-wrap:wrap; gap:14px; }
  .aes-nav{ padding:0 16px; gap:10px; }
  .aes-brand-text{ font-size:15px; } .aes-brand-logo{ height:22px; }
  .aes-nav-tabs button{ padding:7px 9px; font-size:13px; }
  main{ padding:0 16px; }
  .aes-page{ padding:24px 0 50px; gap:18px; }
  .aes-card{ padding:16px; }
  .aes-page-head h1{ font-size:26px; }
  .aes-rec-grid{ grid-template-columns:1fr; }
  .aes-edit-row.driver{ grid-template-columns:1fr 1fr; }
  .aes-edit-srow,.aes-edit-wrow,.aes-wx-edit-head{ grid-template-columns:1fr 1fr; }
  .aes-wx-edit-head{ display:none; }
  .aes-edit-row.head{ display:none; }
}
@media (max-width:600px){
  .aes-nav{ padding:0 12px; gap:8px; }
  .aes-brand-logo{ height:20px; }
  main{ padding:0 12px; }
  .aes-page{ padding:18px 0 44px; gap:16px; }
  .aes-card{ padding:14px; border-radius:12px; }
  .aes-hero{ padding:15px; border-radius:13px; }
  .aes-hero-track{ font-size:25px; }
  .aes-hero-sub{ gap:12px; font-size:13px; margin-bottom:14px; }
  .aes-cd-num{ font-size:27px; }
  .aes-cd-cell{ min-width:0; flex:1; }
  .aes-page-head h1{ font-size:22px; }
  .aes-page-head p{ font-size:13px; }
  .aes-controls{ gap:8px; }
  .aes-toggle{ max-width:100%; overflow-x:auto; scrollbar-width:none; -ms-overflow-style:none; }
  .aes-toggle::-webkit-scrollbar{ display:none; }
  .aes-toggle button{ flex:0 0 auto; padding:7px 10px; font-size:13px; }
  .aes-prof-stats{ grid-template-columns:repeat(2,1fr); }
  .aes-prof-head{ gap:12px; }
  .aes-prof-num{ font-size:34px; min-width:44px; }
  .aes-prof-name{ font-size:22px; }
  .aes-entry{ flex-wrap:wrap; }
}
@media (prefers-reduced-motion:reduce){
  .aes *{ animation:none !important; transition:none !important; }
}
`}</style>
  );
}
