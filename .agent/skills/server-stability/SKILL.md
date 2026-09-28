---
name: server-stability
description: Mandatory rules and procedures for 9Router server stability, build safety, and deployment without crashing or overloading the VPS or Supabase database.
---

# Server Stability & Safe Deployment Skill for 9Router

This skill governs all code updates, build processes, and runtime operations for **9Router** deployed on a low-spec (1GB RAM) VPS with Supabase (Free/Nano tier).

## 1. Absolute Golden Rules for VPS Operations
- **NEVER run `npm run build` or `npm run dev` on the VPS.** The VPS only has 1GB RAM. Running webpack/next compiler on the VPS will trigger Linux OOM-killer and crash the machine.
  - ALWAYS build locally: `npm run build` on the development workstation.
  - Compress `.next`: `tar -czf next_build.tar.gz .next`
  - Upload via scp: `scp -i <key> next_build.tar.gz ubuntu@<ip>:...`
  - Unpack on VPS: `tar -xzf next_build.tar.gz && rm -f next_build.tar.gz && pm2 restart 9router`.
- **Always pass `-n` to SSH commands on Windows:** e.g. `ssh -n -i <key> ubuntu@<ip> "command"`. Without `-n`, `ssh.exe` may freeze waiting on standard input.
- **Do NOT perform rapid back-to-back deployments or restarts:** Wait at least 15-30 seconds between server restarts so background TCP sockets and database connection pools have time to close gracefully.

---

## 2. Supabase Protection & Circuit Breaker Rules
Supabase Free/Nano tier has strict connection pool limits (15-20 max connections) and limited CPU/IO.
- **Circuit Breaker is Mandatory:**
  - If Supabase returns HTTP 502, 503, 504, 520-524, or connection timeout, the circuit breaker opens for **15 seconds**.
  - During the 15-second cooldown, all database queries MUST fail-fast in 0ms and fall back to in-memory/disk cache without sending network requests to Supabase.
  - This shields Supabase from query stampedes and allows Postgres to recover.
- **Strict 6s Timeout:** Every HTTP call to Supabase must enforce an `AbortSignal.timeout(6000)` timeout. Never let a query hang for 30-156s.
- **Persistent Disk Fallback Cache:**
  - All critical operational tables (`providerConnections`, `settings`, `apiKeys`, `client_keys`, `combos`, `providerNodes`, `proxyPools`, `kv`) must maintain a disk-backed snapshot (`.cache/supabase-fallback.json`).
  - If the server restarts during a Supabase outage, it immediately loads from this snapshot so the Admin Dashboard and Chat API remain 100% operational.

---

## 3. Query Optimization & Zero Full-Table-Scans
- **Never run `WHERE timestamp >= ? ORDER BY id DESC LIMIT N` on `usageHistory`:**
  - Postgres does NOT know `id` and `timestamp` are correlated. If rows matching `timestamp >= ?` are fewer than `N`, Postgres scans the **entire table backwards to row #1**!
  - **Correct pattern:** Query `SELECT ... FROM usageHistory ORDER BY id DESC LIMIT 500` with **NO WHERE clause**. It stops instantly after 500 rows using `usage_history_pkey` in < 2ms. Filter the 500 rows by timestamp in JavaScript memory.
- **Zero redundant writes per chat request:**
  - In `saveRequestUsage`: Do NOT run sequential transactions (`SELECT/UPDATE usageDaily`, `SELECT/UPDATE _meta`). Run a single async `INSERT INTO usageHistory`.
  - In `auth.js` round-robin rotation: Do NOT write `lastUsedAt` / `consecutiveUseCount` to Supabase on every single chat request. Update in memory/disk cache (`{ memoryOnly: true }`).

---

## 4. Memory Leak & OOM Prevention (PM2 450MB Limit)
- **Do not clone multi-megabyte request bodies:**
  - When clients send 400,000-token requests (4MB JSON), parse `request.json()` ONCE.
  - Compute `approxPromptTokens = Math.ceil(contentLength / 4)` and pass the number, not the 4MB object, into streaming callbacks.
  - Do NOT retain large JSON payloads in streaming closures.
- **Keep Observability / RequestDetails lightweight:**
  - `OBSERVABILITY_ENABLED` must default to `false`.
  - Truncate large message arrays before buffering in RAM. Cap in-memory write buffer to 50 items.
