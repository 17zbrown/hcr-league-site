import LeagueApp from "@/components/LeagueApp";
import { fetchLeagueData, isConfigured } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export default async function Page() {
  const data = isConfigured() ? await fetchLeagueData() : null;

  if (!data) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "'JetBrains Mono', monospace", color: "#8A95A5", padding: 24, textAlign: "center" }}>
        <div style={{ maxWidth: 460 }}>
          <h1 style={{ color: "#F5EE30", fontSize: 18, letterSpacing: ".1em" }}>HCR LEAGUE</h1>
          <p style={{ lineHeight: 1.6, fontSize: 13 }}>
            Database not connected yet. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run <code>supabase/schema.sql</code> and{" "}
            <code>supabase/seed.sql</code>, then redeploy.
          </p>
        </div>
      </main>
    );
  }

  return <LeagueApp initialData={data} />;
}
