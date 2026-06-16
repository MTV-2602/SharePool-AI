import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Get usage logs for a specific client key
export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100');

  const { data, error } = await supabase
    .from('client_key_usage_logs')
    .select('*')
    .eq('client_key_id', id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
