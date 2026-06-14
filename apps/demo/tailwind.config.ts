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
        // surface
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        "canvas-soft": "rgb(var(--canvas-soft) / <alpha-value>)",
        "canvas-card": "rgb(var(--canvas-card) / <alpha-value>)",
        "canvas-mid": "rgb(var(--canvas-mid) / <alpha-value>)",
        cream: "rgb(var(--cream) / <alpha-value>)",
        navy: "rgb(var(--navy) / <alpha-value>)",
        hairline: "rgb(var(--hairline) / <alpha-value>)",
        "hairline-input": "rgb(var(--hairline-input) / <alpha-value>)",
        // text
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-secondary": "rgb(var(--ink-secondary) / <alpha-value>)",
        "ink-mute": "rgb(var(--ink-mute) / <alpha-value>)",
        "ink-mute-2": "rgb(var(--ink-mute-2) / <alpha-value>)",
        body: "rgb(var(--body) / <alpha-value>)",
        "body-mid": "rgb(var(--body-mid) / <alpha-value>)",
        // "primary" == white
        primary: "rgb(var(--primary) / <alpha-value>)",
        "primary-deep": "rgb(var(--primary-deep) / <alpha-value>)",
        "primary-press": "rgb(var(--primary-press) / <alpha-value>)",
        "primary-soft": "rgb(var(--primary-soft) / <alpha-value>)",
        "primary-subdued": "rgb(var(--primary-subdued) / <alpha-value>)",
        "on-primary": "rgb(var(--on-primary) / <alpha-value>)",
        // black marketing CTA + semantic
        "ink-button": "rgb(var(--ink-button) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        attention: "rgb(var(--attention) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
        // accents
        ruby: "rgb(var(--ruby) / <alpha-value>)",
        "accent-oculus": "rgb(var(--accent-oculus) / <alpha-value>)",
        "accent-sunset": "rgb(var(--accent-sunset) / <alpha-value>)",
        "accent-sunset-soft": "rgb(var(--accent-sunset-soft) / <alpha-value>)",
        "accent-dusk": "rgb(var(--accent-dusk) / <alpha-value>)",
        "accent-twilight": "rgb(var(--accent-twilight) / <alpha-value>)",
        "accent-breeze": "rgb(var(--accent-breeze) / <alpha-value>)",
        "accent-midnight": "rgb(var(--accent-midnight) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        e1: "var(--shadow-1)",
        e2: "var(--shadow-2)",
      },
      borderRadius: {
        pill: "9999px",
      },
    },
  },
  plugins: [],
};

export default config;
