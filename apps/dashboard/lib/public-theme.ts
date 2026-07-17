/**
 * Public raffle pages are always dark. Keep the root dark class when a client
 * navigation leaves the share page so the authenticated destination cannot
 * reveal a stale light document between layouts.
 */
export function activatePublicDarkTheme(root: {
  classList: { add(token: string): void };
}): void {
  root.classList.add("dark");
}
