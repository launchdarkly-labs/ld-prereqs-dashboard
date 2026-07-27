import type { NextConfig } from "next";

// Set NEXT_PUBLIC_BASE_PATH=/<repo-name> when deploying to a GitHub Pages
// project site; leave it unset for Vercel or any root-domain host.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
