require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    // Check schema
    const schema = await db.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='upstream_accounts' ORDER BY ordinal_position"
    );
    console.log('=== upstream_accounts schema ===');
    schema.rows.forEach(c => console.log(' ', c.column_name, ':', c.data_type));

    // Check data with is_active = 1
    const r1 = await db.query('SELECT name, is_active FROM upstream_accounts WHERE is_active = 1');
    console.log('\n=== WHERE is_active = 1 ===', r1.rows.length, 'rows');
    r1.rows.forEach(a => console.log(' -', a.name, '| is_active:', a.is_active, typeof a.is_active));

    // Check data with is_active = true
    const r2 = await db.query('SELECT name, is_active FROM upstream_accounts WHERE is_active = true');
    console.log('\n=== WHERE is_active = true ===', r2.rows.length, 'rows');
    r2.rows.forEach(a => console.log(' -', a.name));
  } catch(err) {
    console.log('ERROR:', err.message);
  } finally {
    db.end();
  }
}
run();
