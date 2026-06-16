import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST: Reserve a hotmail account for the extension to use
export async function POST(request) {
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';

  // Find an available hotmail and reserve it
  const { data: accounts } = await supabase
    .from('hotmail_accounts')
    .select('*')
    .eq('status', 'available')
    .order('usage_count', { ascending: true })
    .limit(1);

  if (!accounts?.length) {
    return NextResponse.json({ error: 'No available hotmail accounts' }, { status: 404 });
  }

  const account = accounts[0];
  
  // Reserve it
  await supabase
    .from('hotmail_accounts')
    .update({
      status: 'reserved',
      reserved_by_ip: clientIp,
      usage_count: account.usage_count + 1,
      last_used_at: new Date().toISOString(),
    })
    .eq('id', account.id);

  return NextResponse.json({
    email: account.email,
    password: account.password,
    totp_secret: account.totp_secret,
  });
}
