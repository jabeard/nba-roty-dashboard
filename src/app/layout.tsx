import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rookie Radar · NBA Rookie of the Year Tracker",
  description:
    "Follow the rookie race with transparent rankings, season stats, and recent form. An independent NBA dashboard with illustrative demo data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
