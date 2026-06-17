import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          orange: "#e0301e",
          rose: "#d93954",
          tangerine: "#eb8c00",
          ink: "#2d2d2d",
        },
      },
    },
  },
  plugins: [],
};
export default config;
