const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.eslfxpccttexenmsybbq:MySecretPassword123!@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true' });
client.connect().then(async () => {
  const latestRes = await client.query('SELECT created_at, model, billed_tokens FROM client_key_usage_logs ORDER BY created_at DESC LIMIT 5');
  console.log('\n--- LATEST 5 LOGS ---');
  for (const log of latestRes.rows) {
    console.log(`Time: ${log.created_at} | Model: ${log.model} | Billed Tokens: ${log.billed_tokens}`);
  }
  await client.end();
}).catch(console.error);
