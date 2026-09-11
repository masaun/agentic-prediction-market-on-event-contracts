import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @apm/market-engine is an unbuilt workspace package (ships .ts directly),
  // so it needs the same transpile pass as first-party app code.
  transpilePackages: ["@apm/market-engine"],
};

export default nextConfig;
