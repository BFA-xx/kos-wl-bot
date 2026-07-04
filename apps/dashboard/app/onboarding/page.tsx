"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSlug = slugEdited ? slug : slugify(name);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, slug: effectiveSlug, logoUrl: logoUrl || null }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body.slug) {
      router.push(`/${body.slug}/settings?connect=1`);
      router.refresh();
    } else {
      setError(body.error ?? "Couldn't create the organization.");
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-10">
      <div className="pointer-events-none absolute -top-40 right-10 h-[36rem] w-[36rem] rounded-full bg-kos-fg/[0.04] blur-3xl" />
      <div className="relative w-full max-w-lg rounded-2xl border border-kos-border bg-kos-panel/60 p-8 backdrop-blur-xl">
        <div className="mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-kos-fg text-sm font-black text-kos-bg">
            KOS
          </div>
          <h1 className="mt-4 text-xl font-semibold">Create your organization</h1>
          <p className="mt-1 text-sm text-kos-muted">
            An organization is your community's space on KOS. You'll connect a
            Discord server next.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-400">
            {error}
          </p>
        ) : null}

        <form onSubmit={create} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-kos-muted">
              Community name
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="kos-input"
              placeholder="e.g. KOS"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-kos-muted">
              Handle (URL)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-kos-muted">kos.app/</span>
              <input
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(slugify(e.target.value));
                }}
                className="kos-input"
                placeholder="your-handle"
                required
              />
            </div>
            <p className="mt-1 text-[11px] text-kos-muted/70">
              Lowercase letters, numbers and dashes. This is your dashboard URL.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-kos-muted">
              Logo URL (optional)
            </label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              className="kos-input"
              placeholder="https://…/logo.png"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !name || !effectiveSlug}
            className="kos-btn-primary w-full disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}
