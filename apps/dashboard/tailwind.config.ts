import type { Config } from "tailwindcss";

const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware KOS palette driven by CSS variables (see globals.css).
        // Works in both light and dark via the `.dark` class on <html>.
        kos: {
          bg: v("--kos-bg"),
          panel: v("--kos-panel"),
          card: v("--kos-card"),
          line: v("--kos-line"),
          border: v("--kos-border"),
          white: v("--kos-fg"), // primary text/foreground
          fg: v("--kos-fg"),
          silver: v("--kos-silver"),
          grey: v("--kos-muted"),
          muted: v("--kos-muted"),
          black: v("--kos-bg"),
          accent: v("--kos-fg"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
