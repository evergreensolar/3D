import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Server-only packages that must not be bundled by webpack.
  serverExternalPackages: ["pdfkit", "playwright-core", "@prisma/client", "@aws-sdk/client-s3"],
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera/microphone are needed for Jitsi (phase 2) and video approval (phase 3)
          { key: "Permissions-Policy", value: "camera=(self \"https://meet.jit.si\"), microphone=(self \"https://meet.jit.si\"), display-capture=(self \"https://meet.jit.si\"), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
