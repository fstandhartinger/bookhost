import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: { colors: { ink: "#152f2c", paper: "#faf9f5", moss: "#286752" } },
  },
  plugins: [],
} satisfies Config;
