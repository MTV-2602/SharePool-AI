import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET: Get single client key
export async function GET(request, { params }) {
  const { id } = await params;
  const { data, error } = await supabase
    .from('client_keys')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

// PUT: Update client key
export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    const body = await request.json();
    
    const updateFields = {};
    if (body.label !== undefined) updateFields.label = body.label;
    if (body.owner_note !== undefined) updateFields.owner_note = body.owner_note;
    if (body.quota_tokens !== undefined) updateFields.quota_tokens = body.quota_tokens;
    if (body.max_concurrent !== undefined) updateFields.max_concurrent = body.max_concurrent;
    if (body.rate_limit_per_minute !== undefined) updateFields.rate_limit_per_minute = body.rate_limit_per_minute;
    if (body.model_multiplier !== undefined) updateFields.model_multiplier = body.model_multiplier;
    if (body.active !== undefined) updateFields.active = body.active;
    if (body.expires_at !== undefined) updateFields.expires_at = body.expires_at;

    const { data, error } = await supabase
      .from('client_keys')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE: Delete client key
export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error } = await supabase
    .from('client_keys')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
