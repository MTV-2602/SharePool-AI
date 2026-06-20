import { getSettings } from "./localDb";

export async function sendTelegramAlert(text) {
  try {
    const settings = await getSettings().catch(() => ({}));
    const botToken = settings?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    
    let chatIds = [];
    const envAllowed = process.env.ALLOWED_USER_IDS || settings?.ALLOWED_USER_IDS;
    if (envAllowed) {
      chatIds = String(envAllowed).split(',').map(id => id.trim()).filter(Boolean);
    }
    
    if (chatIds.length === 0 || !botToken) {
      console.warn('[Telegram Alert] Missing bot token or allowed chat IDs. Alert:', text);
      return;
    }

    for (const chatId of chatIds) {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'HTML'
        }),
      }).catch(err => console.error(`[Telegram Alert] Failed to send to ${chatId}:`, err.message));
    }
  } catch (err) {
    console.error('[Telegram Alert] Failed to send alert:', err.message);
  }
}