import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function parseHotmailLine(rawLine) {
  const parts = String(rawLine || "").trim().split("|").map((p) => String(p || "").trim());
  if (parts.length < 3) return null;
  if (parts.length === 3) return { email: parts[0].toLowerCase(), password: parts[1], totp_secret: parts[2] };
  return {
    email: parts[0].toLowerCase(),
    password: parts[1],
    refresh_token: parts[2],
    client_id: parts[3],
    totp_secret: parts[4] || ""
  };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, line, top } = body;
    let cred = null;

    if (line && line.trim()) {
      cred = parseHotmailLine(line.trim());
    } else if (email && email.trim()) {
      const { data: accounts } = await supabase
        .from('hotmail_accounts')
        .select('*')
        .eq('email', email.trim().toLowerCase())
        .limit(1);
      if (accounts && accounts.length > 0) {
        cred = accounts[0];
      }
    }

    if (!cred || !cred.email) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản Hotmail.' }, { status: 404 });
    }

    // Auto-save if provided via raw line
    if (line && cred.email) {
      const { data: existing } = await supabase
        .from('hotmail_accounts')
        .select('id')
        .eq('email', cred.email)
        .limit(1);

      if (!existing || existing.length === 0) {
        await supabase
          .from('hotmail_accounts')
          .insert({
            email: cred.email,
            password: cred.password || '',
            refresh_token: cred.refresh_token || '',
            client_id: cred.client_id || '',
            totp_secret: cred.totp_secret || '',
            status: 'available',
            usage_count: 0
          });
      } else {
        await supabase
          .from('hotmail_accounts')
          .update({
            password: cred.password || '',
            refresh_token: cred.refresh_token || '',
            client_id: cred.client_id || '',
            totp_secret: cred.totp_secret || ''
          })
          .eq('email', cred.email);
      }
    }

    if (!cred.refresh_token || !cred.client_id) {
      return NextResponse.json({ error: 'Acc Hotmail thiếu refresh token hoặc client ID Outlook.' }, { status: 400 });
    }

    // Exchange refresh token for access token via MS Graph
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cred.client_id,
        refresh_token: cred.refresh_token,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Read',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'Failed to obtain access token', details: tokenData }, { status: 401 });
    }

    // Update refresh token if rotated
    if (tokenData.refresh_token && tokenData.refresh_token !== cred.refresh_token) {
      await supabase
        .from('hotmail_accounts')
        .update({ refresh_token: tokenData.refresh_token })
        .eq('email', cred.email);
    }

    const topCount = Math.min(50, Math.max(1, parseInt(top || '10', 10)));

    // Fetch latest inbox messages
    const mailRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${topCount}&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,body,isRead`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    if (!mailRes.ok) {
      const errText = await mailRes.text().catch(() => "");
      return NextResponse.json({ error: 'Failed to fetch messages from Microsoft Graph', details: errText, status: mailRes.status }, { status: mailRes.status });
    }

    const mailData = await mailRes.json();
    const messages = (mailData.value || []).map(m => ({
      id: m.id,
      subject: m.subject || "(No subject)",
      receivedDateTime: m.receivedDateTime || "",
      from: m.from || { emailAddress: { address: "(unknown)", name: "(unknown)" } },
      isRead: Boolean(m.isRead),
      bodyPreview: m.bodyPreview || "",
      body: m.body?.content || m.bodyPreview || ""
    }));

    // Update lastreadat
    await supabase
      .from('hotmail_accounts')
      .update({ lastreadat: new Date().toISOString() })
      .eq('email', cred.email);

    return NextResponse.json({
      ok: true,
      email: cred.email,
      count: messages.length,
      messages
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
