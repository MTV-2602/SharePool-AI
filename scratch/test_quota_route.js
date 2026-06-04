'use strict';

const db = require('../src/db');
const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');
const fetch = require('node-fetch');

async function run() {
  try {
    await db.initDB();
    const rows = await db.query('SELECT name, session_token FROM upstream_accounts WHERE is_active = 1 LIMIT 1');
    if (rows.length === 0) {
      console.log('No active accounts in database.');
      return;
    }
    const { name, sessionToken, session_token } = rows[0];
    const finalToken = sessionToken || session_token;
    console.log(`Testing account: ${name}`);

    const client = new ChatGPTClient(finalToken);
    const accessToken = await client.getAccessToken();

    // Replicating route logic
    const usageResponse = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      }
    });

    if (!usageResponse.ok) {
      throw new Error(`OpenAI Wham API returned ${usageResponse.status}`);
    }

    const data = await usageResponse.json();
    const limits = [];

    function parseResetTime(resetValue) {
      if (!resetValue) return null;
      try {
        if (typeof resetValue === 'number') {
          return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
        }
        if (typeof resetValue === 'string') {
          if (/^\d+$/.test(resetValue)) {
            const timestamp = Number(resetValue);
            return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
          }
          return new Date(resetValue).toISOString();
        }
        return null;
      } catch (error) {
        return null;
      }
    }

    function getWindowName(baseName, limitWindowSeconds) {
      if (!limitWindowSeconds) return baseName;
      const secs = Number(limitWindowSeconds);
      if (secs <= 18000) return `${baseName} (5h)`;
      if (secs <= 604800) return `${baseName} (Weekly)`;
      if (secs <= 2592000) return `${baseName} (Monthly)`;
      return `${baseName}`;
    }

    function addWindow(id, baseName, window) {
      if (!window || typeof window !== 'object') return;
      const usedPercent = Math.max(0, Math.min(100, Math.ceil(window.used_percent ?? window.percent_used ?? 0)));
      const remainingPercent = Math.max(0, 100 - usedPercent);
      const resetAt = parseResetTime(window.reset_at || window.resets_at || null);
      const name = getWindowName(baseName, window.limit_window_seconds || window.window_seconds);
      
      limits.push({
        id,
        name,
        used: usedPercent,
        total: 100,
        remaining: remainingPercent,
        resetAt
      });
    }

    const byLimitId = data.rate_limits_by_limit_id || data.rate_limits || {};
    for (const [key, limitObj] of Object.entries(byLimitId)) {
      if (limitObj && typeof limitObj === 'object') {
        const primary = limitObj.primary_window || limitObj.primary;
        const secondary = limitObj.secondary_window || limitObj.secondary;
        
        let friendlyName = key === 'codex' ? 'Codex Quota' : key === 'code_review' || key === 'review' ? 'Review Quota' : `${key} Quota`;
        
        if (primary) {
          addWindow(`${key}_session`, friendlyName, primary);
        }
        if (secondary) {
          addWindow(`${key}_weekly`, friendlyName, secondary);
        }
      }
    }

    if (limits.length === 0 && data.rate_limit) {
      const primary = data.rate_limit.primary_window || data.rate_limit.primary;
      const secondary = data.rate_limit.secondary_window || data.rate_limit.secondary;
      if (primary) {
        addWindow('session', 'Codex Quota', primary);
      }
      if (secondary) {
        addWindow('weekly', 'Codex Quota', secondary);
      }
    }

    console.log('Parsed Limits:', JSON.stringify(limits, null, 2));

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    process.exit(0);
  }
}

run();
