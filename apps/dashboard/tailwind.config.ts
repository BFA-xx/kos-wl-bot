import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kos: {
          black: "#000000",
          panel: "#0c0c0c",
          card: "#121212",
          border: "#222222",
          line: "#1b1b1b",
          white: "#ffffff",
          silver: "#c0c0c0",
          grey: "#7d7d7d",
          muted: "#8a8a8a",
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
