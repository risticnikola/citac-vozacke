import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? 'http://localhost:3050';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.0.32'],
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
