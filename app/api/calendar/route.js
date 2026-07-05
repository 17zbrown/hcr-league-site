import { fetchLeagueData } from "@/lib/leagueData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Season schedule as an iCalendar (.ics) feed. Users can download it or
   subscribe, and calendar apps will pick up date changes automatically. */
const pad = (n) => String(n).padStart(2, "0");
function icsDate(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
    "T" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
}
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export async function GET() {
  try {
    const data = await fetchLeagueData();
    const now = icsDate(new Date());
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//HCR League//Schedule//EN",
      "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
      `X-WR-CALNAME:HCR League — ${esc(data.league.season)}`,
      "X-WR-TIMEZONE:America/New_York",
    ];
    for (const ev of data.events) {
      if (!ev.date) continue;
      const start = new Date(ev.date);
      if (isNaN(start)) continue;
      const end = new Date(start.getTime() + Math.max(30, ev.durationMin || 90) * 60000);
      const title = `R${ev.round} · ${ev.name || ev.track} — HCR League`;
      lines.push(
        "BEGIN:VEVENT",
        `UID:hcr-${ev.id}@hcrleague`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${esc(title)}`,
        `LOCATION:${esc([ev.track, ev.location].filter(Boolean).join(", "))}`,
        `DESCRIPTION:${esc(`${ev.name ? ev.name + " at " + ev.track + ". " : ""}Full details: https://hcrleague.netlify.app/`)}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    return new Response(lines.join("\r\n"), {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'attachment; filename="hcr-league.ics"',
        "cache-control": "public, s-maxage=3600",
      },
    });
  } catch {
    return new Response("Calendar unavailable", { status: 502 });
  }
}
