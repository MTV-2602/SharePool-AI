// src/models/HotmailAccount.js — Repository for hotmail_accounts table
'use strict';

const db = require('../db');

const HotmailAccount = {
  /**
   * Count accounts matching query criteria
   */
  count(queryObj = {}) {
    let sql = 'SELECT COUNT(*) as count FROM hotmail_accounts';
    const params = [];
    const wheres = [];

    if (queryObj.state && queryObj.state !== 'all') {
      wheres.push('state = ?');
      params.push(queryObj.state);
    }
    if (queryObj.email) {
      wheres.push('email LIKE ?');
      params.push(`%${queryObj.email}%`);
    }

    if (wheres.length) {
      sql += ' WHERE ' + wheres.join(' AND ');
    }

    const row = db.get(sql, params);
    return row ? row.count : 0;
  },

  /**
   * Find accounts matching query criteria (paginated & sorted)
   */
  find(queryObj = {}, { sort = { state: 1, updatedAt: -1 }, skip = 0, limit = 50 } = {}) {
    let sql = 'SELECT * FROM hotmail_accounts';
    const params = [];
    const wheres = [];

    if (queryObj.state && queryObj.state !== 'all') {
      wheres.push('state = ?');
      params.push(queryObj.state);
    }
    if (queryObj.email) {
      wheres.push('email LIKE ?');
      params.push(`%${queryObj.email}%`);
    }

    if (wheres.length) {
      sql += ' WHERE ' + wheres.join(' AND ');
    }

    // Default sort: available first, then reserved, then used, and newest updated first
    sql += ' ORDER BY state ASC, updated_at DESC';
    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, skip);

    return db.query(sql, params);
  },

  /**
   * Find a single account by email
   */
  findOne({ email }) {
    if (!email) return null;
    return db.get('SELECT * FROM hotmail_accounts WHERE email = ?', [email.toLowerCase().trim()]);
  },

  /**
   * Create a new Hotmail account record
   */
  create(fields) {
    const cols = [];
    const placeholders = [];
    const vals = [];

    const cleanFields = {
      email: fields.email.toLowerCase().trim(),
      password: fields.password || '',
      refreshToken: fields.refreshToken || '',
      clientId: fields.clientId || '',
      secret2fa: fields.secret2fa || '',
      state: fields.state || 'available',
      takenByIp: fields.takenByIp || '',
      takenAt: fields.takenAt || '',
      takenNote: fields.takenNote || '',
      usedCount: fields.usedCount || 0,
      lastReadAt: fields.lastReadAt || '',
      reservedAt: fields.reservedAt || '',
      usedAt: fields.usedAt || ''
    };

    for (const [k, v] of Object.entries(cleanFields)) {
      cols.push(k);
      placeholders.push('?');
      vals.push(v);
    }

    cols.push('created_at');
    placeholders.push("datetime('now', 'localtime')");
    cols.push('updated_at');
    placeholders.push("datetime('now', 'localtime')");

    const sql = `INSERT INTO hotmail_accounts (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    db.run(sql, vals);
    return this.findOne({ email: cleanFields.email });
  },

  /**
   * Update fields for a given email
   */
  updateOne({ email }, fields) {
    const pairs = [];
    const vals = [];
    const allowed = [
      'password', 'refreshToken', 'clientId', 'secret2fa', 'state',
      'takenByIp', 'takenAt', 'takenNote', 'usedCount', 'lastReadAt',
      'reservedAt', 'usedAt'
    ];

    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.includes(k)) continue;
      pairs.push(`${k} = ?`);
      vals.push(v);
    }

    if (!pairs.length) return false;

    pairs.push("updated_at = datetime('now', 'localtime')");
    vals.push(email.toLowerCase().trim());

    db.run(`UPDATE hotmail_accounts SET ${pairs.join(', ')} WHERE email = ?`, vals);
    return true;
  },

  /**
   * Find and update matching record (mimics Mongoose query interface)
   */
  findOneAndUpdate(queryObj, updateFields, options = {}) {
    // If querying next available
    if (queryObj.state === 'available') {
      const availableAcc = db.get("SELECT * FROM hotmail_accounts WHERE state = 'available' ORDER BY usedCount ASC LIMIT 1");
      if (!availableAcc) return null;

      const email = availableAcc.email;
      const fields = updateFields.$set || updateFields;
      this.updateOne({ email }, fields);
      return this.findOne({ email });
    }

    // If querying by email
    if (queryObj.email) {
      const email = queryObj.email;
      const fields = updateFields.$set || updateFields;
      const exists = this.findOne({ email });

      if (!exists) {
        if (options.upsert) {
          return this.create({ email, ...fields });
        }
        return null;
      }

      let incUsedCount = 0;
      if (updateFields.$inc && updateFields.$inc.usedCount) {
        incUsedCount = updateFields.$inc.usedCount;
      }

      if (incUsedCount > 0) {
        db.run('UPDATE hotmail_accounts SET usedCount = usedCount + ? WHERE email = ?', [incUsedCount, email.toLowerCase().trim()]);
      }

      this.updateOne({ email }, fields);
      return this.findOne({ email });
    }

    return null;
  },

  /**
   * Find and delete a record by email
   */
  findOneAndDelete({ email }) {
    if (!email) return null;
    const acc = this.findOne({ email });
    if (acc) {
      db.run('DELETE FROM hotmail_accounts WHERE email = ?', [email.toLowerCase().trim()]);
    }
    return acc;
  }
};

module.exports = HotmailAccount;
