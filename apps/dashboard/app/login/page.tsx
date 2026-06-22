"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ERRORS: Record<string, string> = {
  oauth_not_configured: "Discord login isn't configured. Use the password below.",
  invalid_state: "Login session expired. Please try again.",
  token_exchange_failed: "Discord rejected the login. Try again.",
  user_fetch_failed: "Couldn't read your Discord profile. Try again.",
  not_authorized: "Your account isn't authorized for this dashboard.",
  auth_not_configured: "Dashboard auth isn't configured.",
};

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(ERRORS[code] ?? "Login failed. Please try again.");
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next || "/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="kos-card w-full max-w-sm p-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-kos-border bg-kos-panel text-sm font-bold">
            KOS
          </div>
          <div>
            <div className="text-sm font-semibold">KOS WL Bot</div>
            <div className="text-xs text-kos-grey">Dashboard access</div>
          </div>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg border border-kos-border bg-kos-panel px-3 py-2 text-sm text-kos-silver">
            {error}
          </p>
        ) : null}

        <a href="/api/auth/discord/login" className="kos-btn w-full">
          Sign in with Discord
        </a>

        <div className="my-5 flex items-center gap-3 text-xs text-kos-grey">
          <span className="h-px flex-1 bg-kos-line" />
          or password
          <span className="h-px flex-1 bg-kos-line" />
        </div>

        <form onSubmit={submit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="kos-input"
            placeholder="Dashboard password"
          />
          <button type="submit" disabled={loading} className="kos-btn mt-3 w-full">
            {loading ? "Signing in…" : "Sign in with password"}
          </button>
        </form>
      </div>
    </div>
  );
}
