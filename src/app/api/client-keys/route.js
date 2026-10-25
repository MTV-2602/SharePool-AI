export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { validateModelAllowlistConfig } from '@/lib/auth/clientModelPolicy.js';
import { getAllClientKeys, createClientKey } from '@/lib/db/repos/clientKeysRepo.js';

function generateClientKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let key = 'ck-';
  for (let i = 0; i < 48; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// GET: List all client keys
export async function GET() {
  try {
    const data = await getAllClientKeys();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Create a new client key
export async function POST(request) {
  try {
    const body = await request.json();

    let modelAllowlist = null;
    if (body.model_allowlist !== undefined) {
      const validation = validateModelAllowlistConfig(body.model_allowlist);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      modelAllowlist = validation.normalized.length > 0 ? validation.serialized : null;
    }

    const newKey = {
      id: uuidv4(),
      key: generateClientKey(),
      label: body.label || 'Unnamed Key',
      owner_note: body.owner_note || '',
      quota_tokens: body.quota_tokens || 0,
      used_tokens: 0,
      max_concurrent: body.max_concurrent !== undefined ? body.max_concurrent : 15,
      rate_limit_per_minute: body.rate_limit_per_minute !== undefined ? body.rate_limit_per_minute : 1024,
      model_multiplier: body.model_multiplier || {},
      model_allowlist: modelAllowlist,
      active: true,
      expires_at: body.expires_at || null,
    };

    const saved = await createClientKey(newKey);
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
