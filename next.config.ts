import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
        pathname: "/api/ai/file-assets/**",
      },
      {
        protocol: "https",
        hostname: "**",
        pathname: "/api/ai/file-assets/**",
      },
    ],
  },
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
  ],
  experimental: {
    // Auth.js proxy must forward full meeting-audio multipart bodies; the default limit truncates the 32 MB upload before route handlers parse it.
    proxyClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  turbopack: {
    resolveAlias: {
      "./lib/*": "./lib/*",
    },
  },
};

export default nextConfig;
