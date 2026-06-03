require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const db = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function run() {
  try {
    console.log('Reading migration file...');
    const sqlPath = path.join(__dirname, '..', 'supabase_migration_v2.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running migration...');
    await db.query(sql);
    console.log('Migration v2 executed successfully!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    db.end();
  }
}

run();
