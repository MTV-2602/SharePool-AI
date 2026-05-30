const db = require('../src/db');

async function test() {
  try {
    await db.initDB();
    const ApiKey = require('../src/models/ApiKey');
    const result = await ApiKey.findAll();
    console.log('API Keys in DB:', result);
  } catch (err) {
    console.error('Error occurred:', err);
  }
}

test();
