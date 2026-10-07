import type { NextConfig } from "next";

// The live app calls the Go API through /api/*, so the browser only talks to this origin.
const apiUrl = process.env.SEHATLOG_API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
