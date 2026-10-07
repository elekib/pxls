import type { NextConfig } from "next";

const config: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Tests are not part of the server bundle.
  outputFileTracingExcludes: { "*": ["./__tests__/**/*"] },
  poweredByHeader: false,
};

export default config;
