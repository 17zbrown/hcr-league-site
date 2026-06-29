import "./globals.css";

export const metadata = {
  title: "HCR League",
  description: "iRacing endurance league hub — schedule, standings, results and records.",
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
