"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { NewRaffleModal, type DuplicateRaffleRequest } from "./NewRaffleModal";
import { publicRaffleUrl } from "@/lib/raffle-share";

export function RaffleQuickActions({
  raffleId,
  canDuplicate,
  canDelete = false,
  orgSlug,
  raffleStatus,
  editHref,
  deleteRedirectHref,
  onDeleted,
  initialToast,
}: {
  raffleId: number;
  canDuplicate: boolean;
  canDelete?: boolean;
  orgSlug?: string;
  raffleStatus?: string;
  editHref?: string;
  deleteRedirectHref?: string;
  onDeleted?: () => void;
  initialToast?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [duplicate, setDuplicate] = useState<DuplicateRaffleRequest | null>(
    null,
  );
  const [toast, setToast] = useState<string | null>(initialToast ?? null);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

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
      menuRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
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

  useEffect(() => {
    if (!confirmDelete) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteBusy) setConfirmDelete(false);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [confirmDelete, deleteBusy]);

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
      const left = Math.max(
        12,
        Math.min(window.innerWidth - width - 12, rect.right - width),
      );
      const opensUp = rect.bottom + 260 > window.innerHeight;
      setMenuPosition({
        left,
        top: opensUp ? Math.max(12, rect.top - 250) : rect.bottom + 8,
      });
    }
    setOpen(true);
  }

  async function deleteRaffle() {
    if (!orgSlug) return;
    setDeleteBusy(true);
    const response = await fetch(`/api/${orgSlug}/raffles/${raffleId}`, {
      method: "DELETE",
    });
    const body = await response.json().catch(() => ({}));
    setDeleteBusy(false);
    if (!response.ok) {
      setConfirmDelete(false);
      setToast(body.error ?? "The raffle could not be deleted.");
      return;
    }

    setConfirmDelete(false);
    setToast("Raffle deletion queued.");
    onDeleted?.();
    if (deleteRedirectHref) {
      window.location.assign(deleteRedirectHref);
    }
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

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  ref={menuRef}
                  role="menu"
                  style={menuPosition}
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.985 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="fixed z-[130] w-60 overflow-hidden rounded-2xl border border-white/[0.10] bg-[#111]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl"
                >
                  <MenuButton onClick={copyShareLink}>
                    Copy share link
                  </MenuButton>
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
                  {canDelete && orgSlug ? (
                    <>
                      <div className="my-1 border-t border-white/[0.08]" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          setConfirmDelete(true);
                        }}
                        className="block w-full rounded-xl px-3 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                      >
                        Delete raffle
                      </button>
                    </>
                  ) : null}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      {typeof document !== "undefined"
        ? createPortal(
            <AnimatePresence>
              {confirmDelete ? (
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`delete-raffle-${raffleId}-title`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-6"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget && !deleteBusy) {
                      setConfirmDelete(false);
                    }
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.985 }}
                    className="w-full max-w-md rounded-3xl border border-white/[0.10] bg-[#181818] p-5 shadow-2xl shadow-black/70 sm:p-6"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-lg text-red-400">
                      !
                    </div>
                    <h2
                      id={`delete-raffle-${raffleId}-title`}
                      className="mt-4 text-xl font-semibold"
                    >
                      Delete raffle #{raffleId}?
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-kos-muted">
                      This permanently removes the raffle
                      {raffleStatus ? ` (${raffleStatus.toLowerCase()})` : ""},
                      its entries, winners, and proof record. Its Discord raffle
                      post and stored proof files will also be removed. This
                      cannot be undone.
                    </p>
                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        className="kos-btn"
                        autoFocus
                        disabled={deleteBusy}
                        onClick={() => setConfirmDelete(false)}
                      >
                        Keep raffle
                      </button>
                      <button
                        type="button"
                        className="rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={deleteBusy}
                        onClick={deleteRaffle}
                      >
                        {deleteBusy ? "Deleting…" : "Delete permanently"}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}

      {duplicate ? (
        <NewRaffleModal
          duplicate={duplicate}
          onClose={() => setDuplicate(null)}
        />
      ) : null}

      <AnimatePresence>
        {toast ? (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: 16, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 10, x: "-50%" }}
            className="fixed bottom-5 left-1/2 z-[140] w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/[0.10] bg-[#181818]/95 p-3.5 text-sm text-white shadow-2xl shadow-black/60 backdrop-blur-2xl"
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
          </motion.div>
        ) : null}
      </AnimatePresence>
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
