import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProxyOptions } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { loadEnv, type Plugin } from "vite";

const adminDir = path.dirname(fileURLToPath(import.meta.url));

const debugProxy = process.env.ADMIN_DEBUG_PROXY === "1";

function adminDevEnvLogPlugin(): Plugin {
  return {
    name: "admin-dev-env-log",
    configResolved(config) {
      if (config.command !== "serve" || process.env.VITEST) return;

      const env = loadEnv(config.mode, adminDir, "");
      const id =
        env.GITHUB_APP_CLIENT_ID?.trim() ||
        env.VITE_GITHUB_APP_CLIENT_ID?.trim() ||
        "";
      const secret = env.GITHUB_APP_CLIENT_SECRET?.trim() || "";

      if (!id) {
        console.error(
          "\n[fullsend-admin] GITHUB_APP_CLIENT_ID is unset or empty. " +
            "Add it to admin/.env.local (see sample.env.local). " +
            "Sign-in will fail until this is fixed.\n",
        );
      }

      if (!secret) {
        console.warn(
          "\n[fullsend-admin] GITHUB_APP_CLIENT_SECRET is unset or empty. " +
            "The local OAuth Worker cannot exchange codes until it is set in admin/.env.local " +
            "(Wrangler reads .env.local when no .dev.vars* file exists).\n",
        );
      }

      if (debugProxy) {
        console.info(
          "\n[fullsend-admin] ADMIN_DEBUG_PROXY=1 — logging Vite requests and /api → Worker proxy traffic.\n",
        );
      }
    },
  };
}

/** Log every HTTP request the Vite dev server receives (not Worker-native). */
function adminRequestLogPlugin(): Plugin {
  return {
    name: "admin-request-log",
    configureServer(server) {
      if (!debugProxy) return;
      server.middlewares.use((req, _res, next) => {
        console.info("[vite] request", req.method, req.url);
        next();
      });
    },
  };
}

function apiProxy(): ProxyOptions {
  const base: ProxyOptions = {
    target: "http://127.0.0.1:8787",
    changeOrigin: true,
  };

  if (!debugProxy) return base;

  return {
    ...base,
    configure(proxy) {
      proxy.on("error", (err, req) => {
        console.error("[vite-proxy] error", req?.url, err.message);
      });
      proxy.on("proxyReq", (_proxyReq, req) => {
        console.info("[vite-proxy] → Worker", req.method, req.url);
      });
      proxy.on("proxyRes", (proxyRes, req) => {
        console.info(
          "[vite-proxy] ← Worker",
          proxyRes.statusCode,
          req.url,
        );
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, adminDir, "");
  const githubClientId =
    env.GITHUB_APP_CLIENT_ID?.trim() ||
    env.VITE_GITHUB_APP_CLIENT_ID?.trim() ||
    "";

  return {
    base: "/admin/",
    /** Only the client id is exposed to the browser; never `GITHUB_APP_CLIENT_SECRET`. */
    define: {
      "import.meta.env.VITE_GITHUB_APP_CLIENT_ID":
        JSON.stringify(githubClientId),
    },
    plugins: [
      svelte(),
      adminDevEnvLogPlugin(),
      adminRequestLogPlugin(),
    ],
    server: {
      proxy: {
        "/api": apiProxy(),
      },
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts"],
      passWithNoTests: true,
    },
  };
});
