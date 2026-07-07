import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

export const metadata: Metadata = {
  title: "KOS WL Bot — Dashboard",
  description: "Premium NFT whitelist raffle management.",
};

const kosSans = localFont({
  src: [
    {
      path: "../../bot/assets/fonts/Inter-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../bot/assets/fonts/Inter-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-kos-sans",
  display: "swap",
  fallback: [
    "Inter",
    "Geist",
    "SF Pro Display",
    "SF Pro Text",
    "Arial",
    "sans-serif",
  ],
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
