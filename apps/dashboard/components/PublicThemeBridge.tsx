"use client";

import { useLayoutEffect } from "react";
import { activatePublicDarkTheme } from "@/lib/public-theme";

/** Preserve the public page's dark document when its KOS link client-navigates. */
export function PublicThemeBridge() {
  useLayoutEffect(() => {
    activatePublicDarkTheme(document.documentElement);
  }, []);
  return null;
}
