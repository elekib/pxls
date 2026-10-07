import type { NextConfig } from "next";

const config: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  poweredByHeader: false,
};

export default config;
