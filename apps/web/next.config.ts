import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STATIC_EXPORT === "true" ? "export" : undefined,
  poweredByHeader: false,
  ...(process.env.STATIC_EXPORT === "true"
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "same-origin" },
                { key: "X-Frame-Options", value: "SAMEORIGIN" }
              ]
            }
          ];
        }
      })
};

export default nextConfig;
