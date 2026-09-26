import type { Config } from "tailwindcss";

// Every colour is a CSS variable (globals.css) so light and dark mode flip
// the whole site, including the dashboard, without a `dark:` twin on every
// class. `white` means "raised surface" and the slate/amber/red/green/teal shades
// the app already uses are remapped to tokens with enough contrast in both.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: token("ink"),
        paper: token("paper"),
        moss: token("moss"),
        surface: token("surface"),
        sunken: token("sunken"),
        muted: token("muted"),
        "muted-strong": token("muted-strong"),
        faint: token("faint"),
        line: token("line"),
        accent: token("accent"),
        white: token("surface"),
        slate: {
          50: token("sunken"),
          100: token("sunken"),
          200: token("line"),
          300: token("line-strong"),
          400: token("faint"),
          500: token("faint"),
          600: token("muted"),
          700: token("muted-strong"),
          800: token("ink"),
          900: token("ink"),
        },
        amber: {
          50: token("warn-bg"),
          100: token("warn-bg"),
          200: token("warn-line"),
          800: token("warn-fg"),
          900: token("warn-fg"),
        },
        red: {
          50: token("danger-bg"),
          300: token("danger-line"),
          700: token("danger-fg"),
          800: token("danger-fg"),
          900: token("danger-fg"),
        },
        green: { 50: token("ok-bg") },
        // Dashboard notices, invitation box and onboarding steps.
        teal: {
          50: token("ok-bg"),
          100: token("ok-bg"),
          200: token("line-strong"),
          600: token("moss"),
          700: token("moss"),
          800: token("moss"),
          900: token("ink"),
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      maxWidth: { "8xl": "88rem" },
    },
  },
  plugins: [],
} satisfies Config;
