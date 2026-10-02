import type { NextConfig } from "next";

// When deployed behind the team ingress at /app, nginx strips the prefix before it reaches
// Next, so we only prefix asset URLs (not routes). Locally this is empty.
const base = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  assetPrefix: base || undefined,
  serverExternalPackages: ["@fal-ai/client"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
