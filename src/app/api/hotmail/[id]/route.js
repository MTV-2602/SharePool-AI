import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE: Remove a hotmail account
export async function DELETE(request, { params }) {
  const { id } = await params;
  const { error } = await supabase
    .from('hotmail_accounts')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PUT: Update a hotmail account
export async function PUT(request, { params }) {
  const { id } = await params;
  try {
    const body = await request.json();
    
    const updateFields = {};
    if (body.email !== undefined) updateFields.email = body.email;
    if (body.password !== undefined) updateFields.password = body.password;
    if (body.totp_secret !== undefined) updateFields.totp_secret = body.totp_secret;
    if (body.client_id !== undefined) updateFields.client_id = body.client_id;
    if (body.refresh_token !== undefined) updateFields.refresh_token = body.refresh_token;
    if (body.status !== undefined) updateFields.status = body.status;

    const { data, error } = await supabase
      .from('hotmail_accounts')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Update ChatGPT credentials if provided
    if (body.chatgpt_password !== undefined || body.chatgpt_otp_secret !== undefined) {
      const email = data.email || body.email;
      if (email) {
        const { data: existingGpt } = await supabase
          .from('chatgpt_credentials')
          .select('id')
          .eq('email', email)
          .limit(1);

        const updateGpt = {};
        if (body.chatgpt_password !== undefined) updateGpt.password = body.chatgpt_password;
        if (body.chatgpt_otp_secret !== undefined) updateGpt.otp_secret = body.chatgpt_otp_secret;

        if (existingGpt && existingGpt.length > 0) {
          await supabase
            .from('chatgpt_credentials')
            .update(updateGpt)
            .eq('email', email);
        } else {
          await supabase
            .from('chatgpt_credentials')
            .insert({
              email,
              password: updateGpt.password || '',
              otp_secret: updateGpt.otp_secret || '',
              source: 'ManualInput',
              status: 'active'
            });
        }
      }
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
