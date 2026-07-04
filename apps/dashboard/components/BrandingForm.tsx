"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOrg, useCan } from "@/lib/org-context";
import { PERMISSIONS } from "@/lib/permissions";

export function BrandingForm({
  initial,
}: {
  initial: { name: string; logoUrl: string | null; bannerUrl: string | null; description: string | null };
}) {
  const { slug } = useOrg();
  const router = useRouter();
  const canEdit = useCan(PERMISSIONS.BRANDING_EDIT);
  const [name, setName] = useState(initial.name);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(initial.bannerUrl ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/${slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, logoUrl, bannerUrl, description }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg("Saved.");
      router.refresh();
    } else {
      const b = await res.json().catch(() => ({}));
      setMsg(b.error ?? "Couldn't save.");
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Organization name">
        <input className="kos-input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
      </Field>
      <Field label="Handle">
        <input className="kos-input opacity-60" value={slug} disabled readOnly />
      </Field>
      <Field label="Logo URL">
        <input className="kos-input" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} disabled={!canEdit} placeholder="https://…" />
      </Field>
      <Field label="Banner URL">
        <input className="kos-input" value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} disabled={!canEdit} placeholder="https://…" />
      </Field>
      <Field label="Description">
        <textarea
          className="kos-input min-h-[80px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={!canEdit}
          placeholder="What is your community about?"
        />
      </Field>
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button type="submit" className="kos-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          {msg ? <span className="text-sm text-kos-muted">{msg}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-kos-muted">You don't have permission to edit branding.</p>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-kos-muted">{label}</label>
      {children}
    </div>
  );
}
