"use client";

import { useEffect, useState } from "react";

const ERRORS: Record<string, string> = {
  oauth_not_configured: "Discord login isn't configured yet.",
  invalid_state: "Login session expired. Please try again.",
  token_exchange_failed: "Discord rejected the login. Try again.",
  user_fetch_failed: "Couldn't read your Discord profile. Try again.",
  auth_not_configured: "Dashboard auth isn't configured.",
};

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState<string>("/");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) setError(ERRORS[code] ?? "Login failed. Please try again.");
    const n = params.get("next");
    if (n && n.startsWith("/")) setNext(n);
  }, []);

  const loginHref = `/api/auth/discord/login${
    next !== "/" ? `?next=${encodeURIComponent(next)}` : ""
  }`;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      <div className="pointer-events-none absolute -top-40 right-0 h-[36rem] w-[36rem] rounded-full bg-blue-500/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-[30rem] w-[30rem] rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.035] shadow-2xl backdrop-blur-2xl lg:grid-cols-[1.15fr_0.85fr]">
        <div className="hidden border-r border-white/[0.08] p-10 lg:block">
          <div className="inline-flex rounded-full border border-blue-400/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-200">
            Built for Web3 communities
          </div>
          <h1 className="mt-8 max-w-lg text-4xl font-semibold tracking-tight text-white">
            Raffles, tasks, wallets, and community engagement in one premium control room.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-kos-muted">
            KOS helps founders run fair whitelist raffles, verify member actions, collect wallets, and keep every draw auditable.
          </p>
          <div className="mt-10 grid max-w-md gap-3">
            {["Verifiable draws", "Discord + web parity", "Reusable task engine"].map((item) => (
              <div key={item} className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-sm text-kos-fg">
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="p-8 sm:p-10">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 text-base font-black tracking-tight text-white shadow-[0_18px_60px_-25px_rgba(59,130,246,0.9)]">
            KOS
          </div>
          <h1 className="mt-4 text-lg font-semibold">Welcome to KOS</h1>
          <p className="mt-1 text-sm text-kos-muted">
            The whitelist &amp; raffle platform for Web3 communities.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <a
          href={loginHref}
          className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#5865F2] px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.2.36-.43.842-.59 1.226a18.27 18.27 0 0 0-5.487 0A12.68 12.68 0 0 0 9.21 3a19.74 19.74 0 0 0-4.432 1.369C1.96 8.596 1.196 12.71 1.578 16.77a19.9 19.9 0 0 0 6.07 3.058c.492-.667.93-1.376 1.307-2.121a12.9 12.9 0 0 1-2.058-.986c.173-.127.342-.26.505-.397a14.2 14.2 0 0 0 12.195 0c.165.14.334.272.505.397-.657.387-1.352.72-2.06.987.377.744.814 1.453 1.306 2.12a19.87 19.87 0 0 0 6.073-3.058c.448-4.705-.766-8.783-3.204-12.401ZM8.02 14.331c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.955 2.42-2.157 2.42Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.096 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z" />
          </svg>
          Continue with Discord
        </a>

        <p className="mt-5 text-center text-xs text-kos-muted/70">
          By continuing you agree to KOS's terms. New here? Signing in creates
          your account.
        </p>
        </div>
      </div>
    </div>
  );
}
