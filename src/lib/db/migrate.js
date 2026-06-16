// Dummy migrate file for Supabase backend.
// Database schema is applied directly in Supabase SQL editor.

export class MigrationAborted extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationAborted";
  }
}

export async function runMigrationOnce(adapter) {
  // No-op for Supabase setup
  console.log("[DB] Supabase adapter active. Skipping SQLite-specific migrations.");
  return { applied: 0, from: 0, to: 0 };
}
