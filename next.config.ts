import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Collector card metadata can point at different HTTPS asset hosts. Keep image
    // delivery browser-direct so the Next optimizer never proxies arbitrary URLs.
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
