const { spawnSync } = require("node:child_process");

// Keep the upstream build for Docker and the CLI. Turbopack avoids the webpack
// heap exhaustion seen with the Windows workspace build.
const useTurbopack = process.platform === "win32" && process.env.NEXT_TRACING_ROOT_MODE !== "workspace";
const next = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [next, "build", useTurbopack ? "--turbopack" : "--webpack", ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
