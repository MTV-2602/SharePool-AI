const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://postgres.eslfxpccttexenmsybbq:MySecretPassword123!@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true' });
client.connect().then(async () => {
  const keyId = 'da42bc2e-604e-4b98-90a1-3a034c056237';
  const keyRes = await client.query('SELECT * FROM client_keys WHERE id = \'' + keyId + '\'');
  console.log('Client Key Info:', keyRes.rows[0]);
  
  const countRes = await client.query('SELECT COUNT(*) FROM client_key_usage_logs WHERE client_key_id = \'' + keyId + '\'');
  console.log('Total Logs Count:', countRes.rows[0].count);
  
  const sumRes = await client.query('SELECT SUM(prompt_tokens) as p, SUM(completion_tokens) as c, SUM(billed_tokens) as b FROM client_key_usage_logs WHERE client_key_id = \'' + keyId + '\'');
  console.log('Summed Tokens from Logs:', sumRes.rows[0]);
  
  const latestRes = await client.query('SELECT * FROM client_key_usage_logs WHERE client_key_id = \'' + keyId + '\' ORDER BY created_at DESC LIMIT 5');
  console.log('Latest 5 Logs:', latestRes.rows);
  await client.end();
}).catch(console.error);
