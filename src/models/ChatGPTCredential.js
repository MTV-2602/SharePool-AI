// src/models/ChatGPTCredential.js — Repository for chatgpt_credentials table
// Lưu credentials (email/password/2FA) do AutoRegUnified đẩy lên sau khi đăng ký
'use strict';

const db = require('../db');

const ChatGPTCredential = {
  async upsert({ email, password, otpSecret, source }) {
    const existing = await ChatGPTCredential.findByEmail(email);
    if (existing) {
      await db.run(
        `UPDATE chatgpt_credentials SET 
          password = ?, otp_secret = ?, source = ?, status = 'active'
         WHERE email = ?`,
        [password || '', otpSecret || '', source || 'AutoReg', email]
      );
      return await ChatGPTCredential.findByEmail(email);
    }
    const { lastInsertRowid } = await db.run(
      `INSERT INTO chatgpt_credentials (email, password, otp_secret, source)
       VALUES (?, ?, ?, ?)`,
      [email, password || '', otpSecret || '', source || 'AutoReg']
    );
    return await ChatGPTCredential.findById(lastInsertRowid);
  },

  async findByEmail(email) {
    return await db.get(`SELECT * FROM chatgpt_credentials WHERE email = ?`, [email]);
  },

  async findById(id) {
    return await db.get(`SELECT * FROM chatgpt_credentials WHERE id = ?`, [id]);
  },

  async findAll({ limit = 100, status } = {}) {
    if (status) {
      return await db.query(
        `SELECT * FROM chatgpt_credentials WHERE status = ? ORDER BY id DESC LIMIT ?`,
        [status, limit]
      );
    }
    return await db.query(
      `SELECT * FROM chatgpt_credentials ORDER BY id DESC LIMIT ?`,
      [limit]
    );
  },

  async count() {
    const rows = await db.query(`SELECT COUNT(*) as cnt FROM chatgpt_credentials`);
    return rows[0]?.cnt || 0;
  },

  async delete(id) {
    await db.run(`DELETE FROM chatgpt_credentials WHERE id = ?`, [id]);
  },

  async deleteByEmail(email) {
    await db.run(`DELETE FROM chatgpt_credentials WHERE email = ?`, [email]);
  },
};

module.exports = ChatGPTCredential;
