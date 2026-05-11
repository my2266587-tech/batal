import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata = {
  title: "בט״ל — ניהול משימות",
  description: "מערכת ניהול מטופלים, פגישות וכספים",
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface min-h-screen">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
