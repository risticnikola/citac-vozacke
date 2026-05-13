import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? 'http://localhost:3050';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/:path*`,
      },
    ];
  },
};

export default nextConfig;
