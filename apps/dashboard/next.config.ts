import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    AGENTGATE_BASE_URL: process.env.AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001",
  },
};

export default nextConfig;