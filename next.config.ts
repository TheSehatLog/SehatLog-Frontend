import type { NextConfig } from "next";

// The live app calls the Go API through /api/* and each escrow custodian through
// /custodians/{group}/*, so the browser only talks to this origin. In production each
// custodian is a separate organisation's service.
const apiUrl = process.env.SEHATLOG_API_URL ?? "http://localhost:8080";
const custodians = {
  sehatlog: process.env.CUSTODIAN_SEHATLOG_URL ?? "http://localhost:8101",
  regulator: process.env.CUSTODIAN_REGULATOR_URL ?? "http://localhost:8102",
  independent: process.env.CUSTODIAN_INDEPENDENT_URL ?? "http://localhost:8103",
};

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiUrl}/:path*` },
      ...Object.entries(custodians).map(([group, url]) => ({ source: `/custodians/${group}/:path*`, destination: `${url}/:path*` })),
    ];
  },
};

export default nextConfig;
