"use client";

import { useState } from "react";

const EMAIL = "Theonlyrealoutis@gmail.com";
const GMAIL = `https://mail.google.com/mail/?view=cm&fs=1&to=${EMAIL}&su=${encodeURIComponent(
  "KOS Support",
)}`;

export function SupportContact() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {/* Gmail compose opens reliably in the browser (mailto can no-op with no
          desktop mail client). */}
      <a href={GMAIL} target="_blank" rel="noreferrer" className="kos-btn-primary">
        Email support
      </a>
      <button onClick={copy} className="kos-btn">
        {copied ? "Copied ✓" : `Copy ${EMAIL}`}
      </button>
      <a href="https://x.com/Tosincrypt" target="_blank" rel="noreferrer" className="kos-btn">
        DM @Tosincrypt on X ↗
      </a>
    </div>
  );
}
