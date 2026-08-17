#!/usr/bin/env node
/**
 * Browser-battery orchestrator — boots the target's server, runs its Playwright
 * battery, tears the server down. Exit code is the battery's.
 *
 *   node scripts/browser-battery.mjs prototype   # build ui-prototype/dist, serve :5175
 *   node scripts/browser-battery.mjs live        # boot `wrangler pages dev` on :8788
 *
 * Env:
 *   BATTERY_CI=1   — use Playwright's bundled chromium (CI has no system Chrome);
 *                    resolve venv-less python (assumes `pip install playwright`).
 *   PROTO_BASE_URL / LIVE_BASE_URL — override the target base URL. When LIVE_BASE_URL
 *                    is set the `live` dev server is NOT booted (point at an
 *                    already-running server or production); PROTO_BASE_URL only
 *                    redirects the battery (the static server is cheap, so it still
 *                    boots).
 *   BATTERY_REBUILD=1 — force a ui-prototype build even when dist/ exists.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ci = process.env.BATTERY_CI === "1";

const TARGETS = {
  prototype: {
    script: "scripts/prototype_smoke.py",
    baseUrlEnv: "PROTO_BASE_URL",
    port: 5175,
    health: { path: "/", attempts: 30, delayMs: 500 },
    boot: async () => {
      const protoDir = path.join(root, "ui-prototype");
      const distIndex = path.join(protoDir, "dist", "index.html");
      if (!existsSync(distIndex) || process.env.BATTERY_REBUILD === "1") {
        const build = await run("npm", ["run", "build"], { cwd: protoDir });
        if (build !== 0) {
          console.error("prototype build failed");
          process.exit(build);
        }
      }
      return spawn("python3", ["-m", "http.server", "5175", "--directory", path.join(protoDir, "dist")], {
        stdio: "ignore",
        detached: true,
      });
    },
  },
  live: {
    script: "scripts/live_surface_battery.py",
    baseUrlEnv: "LIVE_BASE_URL",
    port: 8788,
    health: { path: "/api/health", attempts: 90, delayMs: 2000 },
    boot: async () =>
      spawn(
        "npx",
        ["wrangler", "pages", "dev", "public", "--port", "8788", "--binding", "RATE_LIMIT=10000"],
        { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: "false" } },
      ),
  },
};

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(target) {
  const { path, attempts, delayMs } = target.health;
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try {
      const res = await fetch(`http://127.0.0.1:${target.port}${path}`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
  }
  console.error(`browser-battery: server did not become healthy on :${target.port}`);
  process.exit(1);
}

const targetName = process.argv[2];
const target = TARGETS[targetName];
if (!target) {
  console.error(`usage: node scripts/browser-battery.mjs <${Object.keys(TARGETS).join("|")}>`);
  process.exit(1);
}

let server = null;
if (!process.env[target.baseUrlEnv]) {
  server = await target.boot();
  server.unref();
  await waitHealthy(target);
}

const python = ci ? "python3" : path.join(root, ".venv-test", "bin", "python");
const env = {
  ...process.env,
  [target.baseUrlEnv]: process.env[target.baseUrlEnv] ?? `http://127.0.0.1:${target.port}`,
};
const status = await run(python, [path.join(root, target.script)], { env });

if (server) {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}
process.exit(status);
