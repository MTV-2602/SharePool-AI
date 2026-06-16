// src/services/coursera.js — Coursera Sheets integration service
'use strict';

const fetch = require('node-fetch');

const TELEGRAM_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Parses a comma-separated list of Coursera accounts (newline separated)
 */
function parseCourseraSheetAccounts(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text || !text.includes(',') || !text.includes('@') || text.includes('---')) {
    return [];
  }

  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const accounts = [];
  for (const line of lines) {
    const parts = line.split(',').map((part) => String(part || '').trim());
    if (parts.length < 2 || parts.length > 3) return [];
    const [email, password, courseCode] = parts;
    if (!email || !password || !TELEGRAM_EMAIL_REGEX.test(email)) return [];
    accounts.push({
      email,
      password,
      courseCode: courseCode || '',
    });
  }
  return accounts;
}

/**
 * Pushes account data to Google Sheets via Google Apps Script URL
 */
async function pushToGoogleSheet(scriptUrl, sheetName = '', data = []) {
  if (!scriptUrl) {
    throw new Error('Google Sheet script URL is not configured.');
  }
  const res = await fetch(scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetName, data })
  });
  if (!res.ok) {
    throw new Error(`Google Script returned HTTP ${res.status}`);
  }
  const responseText = await res.text();
  try {
    return JSON.parse(responseText);
  } catch {
    return { success: true, raw: responseText };
  }
}

module.exports = {
  parseCourseraSheetAccounts,
  pushToGoogleSheet
};
