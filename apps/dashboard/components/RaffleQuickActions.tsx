"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NewRaffleModal, type DuplicateRaffleRequest } from "./NewRaffleModal";
import { publicRaffleUrl } from "@/lib/raffle-share";

export function RaffleQuickActions({
  raffleId,
  canDuplicate,
  editHref,
  initialToast,
}: {
  raffleId: number;
  canDuplicate: boolean;
  editHref?: string;
  initialToast?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [duplicate, setDuplicate] = useState<DuplicateRaffleRequest | null>(null);
  const [toast, setToast] = useState<string | null>(initialToast ?? null);
  const [manualLink, setManualLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (
        !rootRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const closeForViewportChange = () => setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", closeForViewportChange);
    window.addEventListener("scroll", closeForViewportChange, true);
    window.requestAnimationFrame(() => {
      menuRef.current
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", closeForViewportChange);
      window.removeEventListener("scroll", closeForViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!toast || manualLink) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [manualLink, toast]);

  async function copyShareLink() {
    const shareUrl = publicRaffleUrl(raffleId);
    setOpen(false);
    setManualLink(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setToast("✓ Share link copied.");
      return;
    } catch {
      // Older/insecure browsers may not expose the async clipboard API.
    }

    let copied = false;
    const textarea = document.createElement("textarea");
    try {
      textarea.value = shareUrl;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    } finally {
      textarea.remove();
    }
    if (copied) {
      setToast("✓ Share link copied.");
    } else {
      setManualLink(shareUrl);
      setToast("Copy the share link manually.");
    }
  }

  function startDuplicate(variant: DuplicateRaffleRequest["variant"]) {
    setOpen(false);
    setDuplicate({ raffleId, variant });
  }

  function toggleMenu() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 240;
      const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
      const opensUp = rect.bottom + 260 > window.innerHeight;
      setMenuPosition({
        left,
        top: opensUp ? Math.max(12, rect.top - 250) : rect.bottom + 8,
      });
    }
    setOpen(true);
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          ref={buttonRef}
          type="button"
          aria-label={`Actions for raffle #${raffleId}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggleMenu}
          className="kos-btn kos-focus min-w-10 px-3"
        >
          <span aria-hidden>•••</span>
          <span className="hidden sm:inline">Actions</span>
        </button>

      </div>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuPosition}
              className="kos-fade fixed z-[130] w-60 overflow-hidden rounded-2xl border border-white/[0.10] bg-[#111]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl"
            >
              <MenuButton onClick={copyShareLink}>Copy share link</MenuButton>
              {canDuplicate ? (
                <>
                  <div className="my-1 border-t border-white/[0.08]" />
                  <MenuButton onClick={() => startDuplicate("SAME")}>
                    Duplicate
                  </MenuButton>
                  <MenuButton onClick={() => startDuplicate("GTD")}>
                    Duplicate as GTD
                  </MenuButton>
                  <MenuButton onClick={() => startDuplicate("FCFS")}>
                    Duplicate as FCFS
                  </MenuButton>
                </>
              ) : null}
              {editHref ? (
                <>
                  <div className="my-1 border-t border-white/[0.08]" />
                  <Link
                    role="menuitem"
                    href={editHref}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-sm text-kos-muted transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
                  >
                    Edit raffle
                  </Link>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {duplicate ? (
        <NewRaffleModal
          duplicate={duplicate}
          onClose={() => setDuplicate(null)}
        />
      ) : null}

      {toast ? (
        <div
          role="status"
          className="kos-fade fixed bottom-5 left-1/2 z-[140] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-white/[0.10] bg-[#181818]/95 p-3.5 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <span>{toast}</span>
            <button
              type="button"
              aria-label="Close notification"
              onClick={() => {
                setToast(null);
                setManualLink(null);
              }}
              className="text-kos-muted hover:text-white"
            >
              ×
            </button>
          </div>
          {manualLink ? (
            <input
              readOnly
              value={manualLink}
              onFocus={(event) => event.currentTarget.select()}
              className="kos-input mt-3 font-mono text-xs"
              aria-label="Share link"
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-kos-muted transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/50"
    >
      {children}
    </button>
  );
}
