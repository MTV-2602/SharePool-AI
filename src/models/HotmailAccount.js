// src/models/HotmailAccount.js — Repository for hotmail_accounts table
'use strict';

const db = require('../db');

const HotmailAccount = {
  /**
   * Count accounts matching query criteria
   */
  async count(queryObj = {}) {
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

    const row = await db.get(sql, params);
    return row ? parseInt(row.count || 0, 10) : 0;
  },

  /**
   * Find accounts matching query criteria (paginated & sorted)
   */
  async find(queryObj = {}, { sort = { state: 1, updatedAt: -1 }, skip = 0, limit = 50 } = {}) {
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

    return await db.query(sql, params);
  },

  /**
   * Find a single account by email
   */
  async findOne({ email }) {
    if (!email) return null;
    return await db.get('SELECT * FROM hotmail_accounts WHERE email = ?', [email.toLowerCase().trim()]);
  },

  /**
   * Create a new Hotmail account record
   */
  async create(fields) {
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
    placeholders.push('CURRENT_TIMESTAMP');
    cols.push('updated_at');
    placeholders.push('CURRENT_TIMESTAMP');

    const sql = `INSERT INTO hotmail_accounts (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    await db.run(sql, vals);
    return await this.findOne({ email: cleanFields.email });
  },

  /**
   * Update fields for a given email
   */
  async updateOne({ email }, fields) {
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

    pairs.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(email.toLowerCase().trim());

    await db.run(`UPDATE hotmail_accounts SET ${pairs.join(', ')} WHERE email = ?`, vals);
    return true;
  },

  /**
   * Find and update matching record (mimics Mongoose query interface)
   */
  async findOneAndUpdate(queryObj, updateFields, options = {}) {
    // If querying next available
    if (queryObj.state === 'available') {
      const availableAcc = await db.get("SELECT * FROM hotmail_accounts WHERE state = 'available' ORDER BY usedCount ASC LIMIT 1");
      if (!availableAcc) return null;

      const email = availableAcc.email;
      const fields = updateFields.$set || updateFields;
      await this.updateOne({ email }, fields);
      return await this.findOne({ email });
    }

    // If querying by email
    if (queryObj.email) {
      const email = queryObj.email;
      const fields = updateFields.$set || updateFields;
      const exists = await this.findOne({ email });

      if (!exists) {
        if (options.upsert) {
          return await this.create({ email, ...fields });
        }
        return null;
      }

      let incUsedCount = 0;
      if (updateFields.$inc && updateFields.$inc.usedCount) {
        incUsedCount = updateFields.$inc.usedCount;
      }

      if (incUsedCount > 0) {
        await db.run('UPDATE hotmail_accounts SET usedCount = usedCount + ? WHERE email = ?', [incUsedCount, email.toLowerCase().trim()]);
      }

      await this.updateOne({ email }, fields);
      return await this.findOne({ email });
    }

    return null;
  },

  /**
   * Find and delete a record by email
   */
  async findOneAndDelete({ email }) {
    if (!email) return null;
    const acc = await this.findOne({ email });
    if (acc) {
      await db.run('DELETE FROM hotmail_accounts WHERE email = ?', [email.toLowerCase().trim()]);
    }
    return acc;
  },

  /**
   * Reset all accounts' state to available
   */
  async resetAll() {
    await db.run("UPDATE hotmail_accounts SET state = 'available', reservedAt = '', usedAt = '', takenAt = '', takenNote = ''");
    return true;
  }
};

module.exports = HotmailAccount;
