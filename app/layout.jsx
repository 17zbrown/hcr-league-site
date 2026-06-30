import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://hcrleague.netlify.app"),
  title: { default: "HCR League — iRacing Endurance Championship", template: "%s · HCR League" },
  description: "The official hub for HCR League: schedule, live standings, race results, records, teams and drivers for our iRacing multi-class (GTP / LMP2 / GTD) endurance championship.",
  applicationName: "HCR League",
  keywords: ["HCR League", "iRacing", "endurance racing", "GTP", "LMP2", "GTD", "sim racing", "championship", "IMSA"],
  openGraph: {
    title: "HCR League — iRacing Endurance Championship",
    description: "Schedule, live standings, results and records for the HCR League endurance championship.",
    url: "/",
    siteName: "HCR League",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "HCR League — iRacing Endurance Championship",
    description: "Schedule, standings, results and records for the HCR League endurance championship.",
  },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0B0E14" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Saira:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
