// src/utils/tokens.js — Token estimation utilities
'use strict';

/**
 * Estimate token count from a string.
 * ~4 ASCII chars = 1 token; ~2 CJK/Vietnamese chars = 1 token
 */
function estimateText(text) {
  if (!text || typeof text !== 'string') return 0;
  const cjk   = (text.match(/[\u00C0-\u024F\u1E00-\u1EFF\u4E00-\u9FFF\uAC00-\uD7AF]/g) || []).length;
  const other  = text.length - cjk;
  return Math.max(1, Math.ceil(cjk / 2 + other / 4));
}

/**
 * Estimate tokens for an array of OpenAI messages
 */
function estimateMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map(c => c.text || '').join('')
        : JSON.stringify(msg.content ?? '');
    return sum + estimateText(content) + 4; // 4 tokens overhead per message
  }, 2); // 2 tokens base overhead
}

/**
 * Format token count for display: 1,500,000 → '1.5M'
 */
function formatTokens(n) {
  if (!n || n === 0) return '0';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)         return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toLocaleString();
}

module.exports = { estimateText, estimateMessages, formatTokens };
