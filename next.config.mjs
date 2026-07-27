import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));
// CLI bundling needs workspace root so tracing includes hoisted node_modules (slim ~50MB).
// Docker / default uses projectRoot so server.js lands at /app/server.js (not nested).
const tracingRoot = process.env.NEXT_TRACING_ROOT_MODE === "workspace"
  ? join(projectRoot, "..")
  : projectRoot;
const proxyClientMaxBodySize = process.env.NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE || "128mb";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3", "sql.js", "node:sqlite", "bun:sqlite"],
  turbopack: {
    root: tracingRoot
  },
  outputFileTracingExcludes: {
    "*": ["./gitbook/**/*"]
  },
  images: {
    unoptimized: true
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  env: {},
  experimental: {
    // #1529/#1572: LLM clients can send long context or base64 image payloads through /v1 rewrites.
    proxyClientMaxBodySize,
  },
  webpack: (config, { isServer }) => {
    // Prevent Webpack from resolving symlinks to realpath outside workspace
    config.resolve.symlinks = false;

    // Ignore fs/path modules in browser bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    // Exclude logs, .next, gitbook subapp from watcher
    config.watchOptions = { ...config.watchOptions, ignored: /[\\/](logs|\.next|gitbook|cli)[\\/]/ };
    return config;
  },
  async rewrites() {
    const targetCloud = process.env.NEXT_PUBLIC_CLOUD_URL || process.env.CLOUD_URL;
    if (targetCloud) {
      const cleanTarget = targetCloud.replace(/\/+$/, "");
      return [
        {
          source: "/v1/v1/:path*",
          destination: `${cleanTarget}/v1/:path*`
        },
        {
          source: "/v1/v1",
          destination: `${cleanTarget}/v1`
        },
        {
          source: "/codex/:path*",
          destination: `${cleanTarget}/api/v1/responses`
        },
        {
          source: "/v1/:path*",
          destination: `${cleanTarget}/v1/:path*`
        },
        {
          source: "/v1",
          destination: `${cleanTarget}/v1`
        }
      ];
    }
    return [
      {
        source: "/v1/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1/v1",
        destination: "/api/v1"
      },
      {
        source: "/codex/:path*",
        destination: "/api/v1/responses"
      },
      {
        source: "/v1/:path*",
        destination: "/api/v1/:path*"
      },
      {
        source: "/v1",
        destination: "/api/v1"
      }
    ];
  }
};

export default nextConfig;
