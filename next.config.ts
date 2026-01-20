import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mark native/binary modules as external so Next.js doesn't bundle them
  serverExternalPackages: ["simple-git", "better-sqlite3"],
};

export default nextConfig;
