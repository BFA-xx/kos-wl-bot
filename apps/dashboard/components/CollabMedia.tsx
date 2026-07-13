"use client";

import { useEffect, useState } from "react";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function PartnerMark({
  name,
  src,
  className = "h-10 w-10 rounded-xl",
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden border border-white/[0.09] bg-gradient-to-br from-blue-500/20 via-white/[0.05] to-violet-500/20 text-xs font-bold text-white ${className}`}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={`${name} logo`}
          className="h-full w-full bg-black/20 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initials(name) || "KOS"}</span>
      )}
    </div>
  );
}

export function RaffleBanner({
  name,
  src,
  fallbackSources = [],
  compact = false,
  className = "aspect-video w-full",
}: {
  name: string;
  src?: string | null;
  fallbackSources?: string[];
  compact?: boolean;
  className?: string;
}) {
  const sources = [src, ...fallbackSources].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
  const sourceKey = sources.join("|");
  const [sourceIndex, setSourceIndex] = useState(0);
  useEffect(() => setSourceIndex(0), [sourceKey]);
  const currentSource = sources[sourceIndex];

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-[#0B0B0B] ${className}`}
    >
      {currentSource ? (
        <img
          src={currentSource}
          alt={`${name} raffle banner`}
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setSourceIndex((index) => index + 1)}
        />
      ) : (
        <>
          <div className="absolute -left-12 top-0 h-40 w-40 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="absolute -bottom-16 right-0 h-40 w-40 rounded-full bg-violet-500/20 blur-3xl" />
          {compact ? (
            <span className="relative text-[10px] font-bold text-white">
              {initials(name) || "KOS"}
            </span>
          ) : (
            <div className="relative flex items-center gap-3 px-5 text-left">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.10] bg-white/[0.06] text-sm font-bold">
                {initials(name) || "KOS"}
              </span>
              <span>
                <span className="block text-sm font-semibold text-white">
                  {name}
                </span>
                <span className="mt-0.5 block text-[10px] uppercase tracking-[0.18em] text-kos-muted">
                  Raffle archive
                </span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
