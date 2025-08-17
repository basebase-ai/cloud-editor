import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Removed COEP headers - no longer needed without WebContainer
  // Optimize font loading and reduce errors
  experimental: {
    optimizePackageImports: ["@mantine/core", "@mantine/hooks"],
  },
};

export default nextConfig;
