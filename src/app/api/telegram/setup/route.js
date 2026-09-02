import { NextResponse } from 'next/server';
import { getSettings } from '@/lib/localDb';

export async function GET(request) {
  try {
    const settings = await getSettings().catch(() => ({}));
    const CURRENT_VALID_TOKEN = '8101230396:AAEk6TMGXo6QLH2rlCwRt0-em5wnouroWxc';
    let botToken = settings?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || CURRENT_VALID_TOKEN;
    if (botToken.includes('AAE_l8KqCJ5yTruNTZSwOrQLSwsVc-DOuco')) {
      botToken = CURRENT_VALID_TOKEN;
    }

    // Determine host from request headers, strip 'api.' prefix if called from API domain
    let host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
    if (host.startsWith('api.')) {
      host = host.slice(4);
    }
    const protocol = request.headers.get('x-forwarded-proto') || 'https';
    
    if (!host) {
      return NextResponse.json({
        ok: false,
        error: 'Cannot determine host name from request headers.'
      }, { status: 400 });
    }

    const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
    const registerUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;

    console.log(`[Telegram Setup] Registering webhook to: ${webhookUrl}`);
    const res = await fetch(registerUrl);
    const result = await res.json();

    return NextResponse.json({
      ok: true,
      message: `Attempted to register Telegram Webhook for ${host}`,
      webhookUrl,
      telegramResponse: result
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err.message
    }, { status: 500 });
  }
}
