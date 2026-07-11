const X_HANDLE = /^[A-Za-z0-9_]{1,15}$/u;

/** Accept @handle, handle, or an x.com/twitter.com profile URL. */
export function normalizeXHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return null;

  let handle = input;
  const urlInput = /^https?:\/\//iu.test(input)
    ? input
    : /^(?:www\.)?(?:x|twitter)\.com\//iu.test(input)
      ? `https://${input}`
      : null;

  if (urlInput) {
    try {
      const url = new URL(urlInput);
      const hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
      if (hostname !== "x.com" && hostname !== "twitter.com") return null;
      handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return null;
    }
  }

  handle = handle.replace(/^@/u, "");
  return X_HANDLE.test(handle) ? handle : null;
}

export function xProfileUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle)}`;
}
