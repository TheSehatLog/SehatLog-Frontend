import type { NextConfig } from "next";

// The live app calls the Go API through /api/* and each escrow custodian through
// /custodians/{group}/*, so the browser only talks to this origin. In production each
// custodian is a separate organisation's service.
//
// Hosted demo (render.yaml): SEHATLOG_BACKEND_HOST is the one-container backend, whose
// gateway serves the API at / and the custodians at /custodians/{group}.
const backendHost = process.env.SEHATLOG_BACKEND_HOST;
const backend = backendHost ? (backendHost.startsWith("http") ? backendHost : `https://${backendHost}`).replace(/\/$/, "") : null;

const apiUrl = process.env.SEHATLOG_API_URL ?? backend ?? "http://localhost:8080";
const custodians = {
  sehatlog: process.env.CUSTODIAN_SEHATLOG_URL ?? (backend ? `${backend}/custodians/sehatlog` : "http://localhost:8101"),
  regulator: process.env.CUSTODIAN_REGULATOR_URL ?? (backend ? `${backend}/custodians/regulator` : "http://localhost:8102"),
  independent: process.env.CUSTODIAN_INDEPENDENT_URL ?? (backend ? `${backend}/custodians/independent` : "http://localhost:8103"),
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
