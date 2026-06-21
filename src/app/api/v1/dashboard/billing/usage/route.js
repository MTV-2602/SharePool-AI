export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { extractBearerToken, validateClientKey } from "@/lib/auth/clientKeyAuth.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function GET(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  const token = extractBearerToken(request);
  if (!token) {
    return new Response(JSON.stringify({ error: { message: "API key required" } }), {
      status: 401,
      headers
    });
  }

  const isClientKey = token.startsWith("ck-") || (token.startsWith("sk-") && token.split("-").length === 2);
  let totalUsageCents = 0; // $0.00 default

  if (isClientKey) {
    const authResult = await validateClientKey(token);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error } }), {
        status: 401,
        headers
      });
    }

    const { quota_tokens = 0, used_tokens = 0 } = authResult.keyData;
    const quota = Number(quota_tokens) || 0;
    const used = Number(used_tokens) || 0;

    if (quota > 0) {
      const usedRatio = Math.min(1.0, used / quota);
      // Hard limit is $120.00 (12000 cents)
      totalUsageCents = Math.round(usedRatio * 120.0 * 100);
    } else {
      // If unlimited, usage is 0, showing 100% remaining
      totalUsageCents = 0;
    }
  }

  const responseBody = {
    "object": "list",
    "daily_costs": [
      {
        "timestamp": Math.floor(Date.now() / 1000) - 86400,
        "line_items": [
          {
            "name": "Instruct models",
            "cost": totalUsageCents
          }
        ]
      }
    ],
    "total_usage": totalUsageCents
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers
  });
}
