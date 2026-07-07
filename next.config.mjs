/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    typedRoutes: false
  },
  outputFileTracingIncludes: {
    "/*": ["./public/data/screenings-latest.json"]
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**"
      },
      {
        protocol: "http",
        hostname: "**"
      }
    ],
    formats: ["image/avif", "image/webp"]
  }
};

export default nextConfig;
