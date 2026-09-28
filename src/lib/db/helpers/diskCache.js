// Edge-safe disk cache helper.
// In Next.js Edge Runtime (middleware.js), filesystem is not supported, so it safely no-ops.

if (!global._diskCacheState) {
  global._diskCacheState = {
    loaded: false,
    data: {},
    saveTimer: null,
  };
}

const state = global._diskCacheState;

function getFsModule() {
  if (process.env.NEXT_RUNTIME === "edge") return null;
  try {
    // Dynamic import to prevent bundler from tracing node:fs into Edge Runtime
    const req = typeof __non_webpack_require__ !== "undefined" ? __non_webpack_require__ : (typeof require !== "undefined" ? require : null);
    if (!req) return null;
    const fs = req("fs");
    const path = req("path");
    const cwd = typeof process.cwd === "function" ? process.cwd() : ".";
    const cacheDir = path.join(cwd, ".cache");
    const cacheFile = path.join(cacheDir, "supabase-fallback.json");
    return { fs, path, cacheDir, cacheFile };
  } catch {
    return null;
  }
}

function ensureLoaded() {
  if (state.loaded) return;
  state.loaded = true;
  const mod = getFsModule();
  if (!mod) return;
  try {
    if (mod.fs.existsSync(mod.cacheFile)) {
      const raw = mod.fs.readFileSync(mod.cacheFile, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state.data = parsed;
      }
    }
  } catch (err) {
    // Ignore load errors
  }
}

function scheduleFlush() {
  if (state.saveTimer) return;
  const mod = getFsModule();
  if (!mod) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    try {
      if (!mod.fs.existsSync(mod.cacheDir)) {
        mod.fs.mkdirSync(mod.cacheDir, { recursive: true });
      }
      const tmpFile = `${mod.cacheFile}.tmp`;
      mod.fs.writeFileSync(tmpFile, JSON.stringify(state.data), "utf8");
      mod.fs.renameSync(tmpFile, mod.cacheFile);
    } catch {
      // Ignore write errors
    }
  }, 2000);
  if (typeof state.saveTimer.unref === "function") {
    state.saveTimer.unref();
  }
}

export function getDiskCache(key, fallback = null) {
  ensureLoaded();
  return state.data[key] !== undefined ? state.data[key] : fallback;
}

export function setDiskCache(key, value) {
  ensureLoaded();
  state.data[key] = value;
  scheduleFlush();
}
