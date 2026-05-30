const db = require('../src/db');

async function test() {
  try {
    await db.initDB();
    const ApiKey = require('../src/models/ApiKey');
    console.log('Creating API key...');
    const result = await ApiKey.create({ name: 'Test Key' });
    console.log('Result:', result);
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

test();
