import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST: Release a reserved hotmail account back to the pool
export async function POST(request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('hotmail_accounts')
      .update({ status: 'available', reserved_by_ip: null })
      .eq('email', email);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
