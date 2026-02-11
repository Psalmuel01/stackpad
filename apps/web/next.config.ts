import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@stackpad/shared", "@stackpad/x402-client"],
};

export default nextConfig;
