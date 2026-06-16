import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: List all hotmail accounts
export async function GET() {
  const { data: hotmails, error: hotmailError } = await supabase
    .from('hotmail_accounts')
    .select('*')
    .order('created_at', { ascending: false });

  if (hotmailError) return NextResponse.json({ error: hotmailError.message }, { status: 500 });
  
  // Fetch ChatGPT credentials to link them in memory
  const { data: gptCreds } = await supabase
    .from('chatgpt_credentials')
    .select('*');

  const gptMap = {};
  if (gptCreds) {
    gptCreds.forEach(c => {
      gptMap[c.email.toLowerCase().trim()] = c;
    });
  }

  const result = hotmails.map(acc => {
    const emailKey = acc.email.toLowerCase().trim();
    const gpt = gptMap[emailKey];
    return {
      ...acc,
      hasChatGPT: !!gpt,
      chatgpt: gpt ? {
        password: gpt.password,
        otp_secret: gpt.otp_secret,
        status: gpt.status,
        created_at: gpt.created_at
      } : null
    };
  });
  
  return NextResponse.json(result);
}

// POST: Add hotmail account(s) - supports bulk import
export async function POST(request) {
  try {
    const body = await request.json();
    
    // Support both single and bulk import
    const accounts = body.accounts || [body];
    
    const toInsert = accounts.map(acc => ({
      email: acc.email,
      password: acc.password || null,
      totp_secret: acc.totp_secret || null,
      client_id: acc.client_id || null,
      refresh_token: acc.refresh_token || null,
      status: 'available',
      usage_count: 0,
    }));

    const { data, error } = await supabase
      .from('hotmail_accounts')
      .upsert(toInsert, { onConflict: 'email' })
      .select();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ inserted: data.length, accounts: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
