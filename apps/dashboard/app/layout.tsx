import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KOS WL Bot — Dashboard",
  description: "Premium NFT whitelist raffle management.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-kos-black text-kos-white antialiased">
        {children}
      </body>
    </html>
  );
}
