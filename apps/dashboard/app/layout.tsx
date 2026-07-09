import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KOS WL Bot — Dashboard",
  description: "Premium NFT whitelist raffle management.",
};

const kosSans = Inter({
  subsets: ["latin"],
  variable: "--font-kos-sans",
  display: "swap",
  adjustFontFallback: true,
});

// Set the theme class before paint to avoid a flash. Defaults to dark (KOS).
const themeInit = `(function(){try{var t=localStorage.getItem('kos-theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={kosSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
