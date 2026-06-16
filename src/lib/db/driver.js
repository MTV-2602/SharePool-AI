// Supabase-only DB driver for Vercel-compatible stateless deployment.
// Replaces the original SQLite-based driver from 9Router.

if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function initAdapter() {
  const { createSupabaseAdapter } = await import('./adapters/supabaseAdapter.js');
  const adapter = createSupabaseAdapter();

  if (!state.logged) {
    console.log('[DB] Driver: supabase-rpc | Supabase PostgreSQL');
    state.logged = true;
  }

  // Run migration check (optional, here we skip migration run as we apply it manually)
  try {
    const { runMigrationOnce } = await import('./migrate.js');
    await runMigrationOnce(adapter);
  } catch (e) {
    console.warn('[DB] Migration skipped or failed:', e.message);
  }

  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error('[DB] adapter not initialized — await getAdapter() first');
  return state.instance;
}
