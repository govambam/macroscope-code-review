import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase serverless function timeout for git operations
  serverExternalPackages: ["simple-git"],
};

export default nextConfig;
