import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Get current status for the Chrome extension
export async function GET() {
  const { count: hotmailCount } = await supabase
    .from('hotmail_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'available');

  return NextResponse.json({
    status: 'online',
    available_hotmails: hotmailCount || 0,
    timestamp: new Date().toISOString(),
  });
}
