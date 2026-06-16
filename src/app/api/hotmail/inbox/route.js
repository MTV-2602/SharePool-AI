import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Read inbox for a hotmail account using MS Graph API
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  
  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  // Fetch account credentials from DB
  const { data: accounts, error } = await supabase
    .from('hotmail_accounts')
    .select('*')
    .eq('email', email)
    .limit(1);

  if (error || !accounts?.length) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const account = accounts[0];
  
  if (!account.refresh_token) {
    return NextResponse.json({ error: 'No refresh token available for this account' }, { status: 400 });
  }

  try {
    // Exchange refresh token for access token via MS Graph
    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: account.client_id || process.env.MS_GRAPH_CLIENT_ID || '00000000402b5328', // Fallback to a common MS ID if empty
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.json({ error: 'Failed to obtain access token', details: tokenData }, { status: 401 });
    }

    // Update refresh token if rotated
    if (tokenData.refresh_token && tokenData.refresh_token !== account.refresh_token) {
      await supabase
        .from('hotmail_accounts')
        .update({ refresh_token: tokenData.refresh_token })
        .eq('id', account.id);
    }

    // Fetch latest inbox messages
    const isLegacyToken = !tokenData.access_token.includes('.');
    let messages = [];

    if (isLegacyToken) {
      const mailRes = await fetch(
        'https://outlook.office.com/api/v2.0/me/messages?$top=10&$orderby=ReceivedDateTime desc&$select=Subject,From,ReceivedDateTime,BodyPreview,IsRead',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const mailData = await mailRes.json();
      messages = (mailData.value || []).map(m => ({
        id: m.Id,
        subject: m.Subject || "(No subject)",
        receivedDateTime: m.ReceivedDateTime || "",
        from: m.From ? {
          emailAddress: {
            address: m.From.EmailAddress?.Address || "(unknown)",
            name: m.From.EmailAddress?.Name || "(unknown)"
          }
        } : { emailAddress: { address: "(unknown)", name: "(unknown)" } },
        isRead: Boolean(m.IsRead),
        bodyPreview: m.BodyPreview || ""
      }));
    } else {
      const mailRes = await fetch(
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$orderby=receivedDateTime desc&$select=subject,from,receivedDateTime,bodyPreview,isRead',
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
      );
      const mailData = await mailRes.json();
      messages = (mailData.value || []).map(m => ({
        id: m.id,
        subject: m.subject || "(No subject)",
        receivedDateTime: m.receivedDateTime || "",
        from: m.from || { emailAddress: { address: "(unknown)", name: "(unknown)" } },
        isRead: Boolean(m.isRead),
        bodyPreview: m.bodyPreview || ""
      }));
    }

    // Update usage stats
    await supabase
      .from('hotmail_accounts')
      .update({
        usage_count: account.usage_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    return NextResponse.json({
      email: account.email,
      messages,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
