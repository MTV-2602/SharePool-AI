'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  console.log('Querying latest usage logs from PostgreSQL...');
  const res = await db.query('SELECT * FROM usage_logs ORDER BY id DESC LIMIT 20');
  console.log(`Found ${res.rows.length} logs:`);
  res.rows.forEach(row => {
    console.log(`[${row.created_at}] Key: ${row.api_key} | Model: ${row.model} | ReqId: ${row.req_id} | In: ${row.tokens_in} | Out: ${row.tokens_out}`);
  });
  
  await db.end();
}

main().catch(console.error);
