// Drop obsolete Hotmail / ChatGPT / OAuth temp tables inherited from legacy builds.
export default {
  version: 2,
  name: "drop-legacy-hotmail",
  up(db) {
    const secureDelete = db.get("PRAGMA secure_delete").secure_delete;
    db.exec("PRAGMA secure_delete = ON");
    try {
      db.exec(`
        DROP TABLE IF EXISTS hotmail_accounts;
        DROP TABLE IF EXISTS chatgpt_credentials;
        DROP TABLE IF EXISTS oauth_states;
      `);
    } finally {
      db.exec(`PRAGMA secure_delete = ${secureDelete}`);
    }
  },
};
