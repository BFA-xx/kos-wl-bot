"use client";

import { useRef, useState } from "react";
import { useOrg } from "@/lib/org-context";

/**
 * Image dropbox: drag-and-drop or click to upload (via Vercel Blob), with a URL
 * paste fallback so it still works if Blob isn't enabled. Reports the final URL.
 */
export function ImageDrop({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const { slug } = useOrg();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/${slug}/upload`, { method: "POST", body: fd });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok && body.url) onChange(body.url);
    else setError(body.error ?? "Upload failed.");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  }

  return (
    <div>
      {label ? <label className="mb-1 block text-xs font-medium text-kos-muted">{label}</label> : null}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-3 transition-colors ${
          drag ? "border-kos-fg bg-kos-fg/5" : "border-kos-border bg-kos-panel/40 hover:bg-kos-panel/70"
        }`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-12 w-12 rounded-lg object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-kos-panel text-lg text-kos-muted">
            +
          </div>
        )}
        <div className="text-sm text-kos-muted">
          {busy ? "Uploading…" : value ? "Change image" : "Drop an image or click to upload"}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <input
        className="kos-input mt-2"
        placeholder="…or paste an image URL"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? <p className="mt-1 text-xs text-amber-400">{error}</p> : null}
    </div>
  );
}
