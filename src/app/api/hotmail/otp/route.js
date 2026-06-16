import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import crypto from 'crypto';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  
  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  const { data: accounts } = await supabase
    .from('hotmail_accounts')
    .select('*')
    .eq('email', email)
    .limit(1);

  if (!accounts?.length) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const account = accounts[0];

  // If TOTP secret is available, generate TOTP code
  if (account.totp_secret) {
    try {
      const code = generateTOTP(account.totp_secret);
      return NextResponse.json({ email, otp: code, source: 'totp' });
    } catch (err) {
      return NextResponse.json({ error: `TOTP generation failed: ${err.message}` }, { status: 500 });
    }
  }

  // Otherwise try to read OTP from latest email
  if (!account.refresh_token) {
    return NextResponse.json({ error: 'No TOTP secret or refresh token available' }, { status: 400 });
  }

  try {
    const tokenRes = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: account.client_id || process.env.MS_GRAPH_CLIENT_ID || '00000000402b5328',
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
        scope: 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'Failed to obtain access token', details: tokenData }, { status: 401 });
    }

    // Read latest 5 emails and look for OTP patterns
    const mailRes = await fetch(
      'https://outlook.office.com/api/v2.0/me/messages?$top=5&$orderby=ReceivedDateTime desc&$select=Subject,Body,ReceivedDateTime',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    if (!mailRes.ok) {
      const errText = await mailRes.text().catch(() => "");
      return NextResponse.json({ error: 'Failed to fetch messages from Outlook API', details: errText, status: mailRes.status }, { status: mailRes.status });
    }

    const mailData = await mailRes.json();
    const messages = (mailData.value || []).map(m => ({
      subject: m.Subject || m.subject,
      body: m.Body?.Content || m.body?.content || m.BodyPreview || m.bodyPreview || "",
      receivedDateTime: m.ReceivedDateTime || m.receivedDateTime
    }));

    // Extract OTP from email body using common patterns
    for (const msg of messages) {
      const body = msg.body || '';
      // Matches a 4 to 8 digit number (common OTP length)
      const otpMatch = body.match(/\b(\d{4,8})\b/);
      if (otpMatch) {
        return NextResponse.json({
          email,
          otp: otpMatch[1],
          source: 'email',
          subject: msg.subject,
          received: msg.receivedDateTime,
        });
      }
    }

    return NextResponse.json({ email, otp: null, source: 'email', message: 'No OTP found in recent emails' });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Simple TOTP implementation (RFC 6238)
function generateTOTP(secret, period = 30, digits = 6) {
  const time = Math.floor(Date.now() / 1000 / period);
  const key = base32Decode(secret);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(time));
  
  const hmac = crypto.createHmac('sha1', key);
  hmac.update(timeBuffer);
  const hash = hmac.digest();
  
  const offset = hash[hash.length - 1] & 0xf;
  const binary = ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  
  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, '0');
}

function base32Decode(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = [];
  let bits = 0;
  let value = 0;
  
  // Clean secret from spaces and hyphens
  const cleanInput = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  
  for (const c of cleanInput) {
    value = (value << 5) | chars.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  
  return Buffer.from(bytes);
}
