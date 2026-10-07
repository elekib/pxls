import type { Config } from "tailwindcss";

// Same setup as the original Vite UI, so its classes render identically.
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
