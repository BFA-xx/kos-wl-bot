/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep the Prisma client server-only and unbundled (Next 14 key).
    serverComponentsExternalPackages: ["@prisma/client"],
    // Allow importing the workspace db package from the monorepo root.
    externalDir: true,
  },
};

export default nextConfig;
