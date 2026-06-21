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
  let hardLimitUsd = 120.0;

  if (isClientKey) {
    const authResult = await validateClientKey(token);
    if (!authResult.valid) {
      return new Response(JSON.stringify({ error: { message: authResult.error } }), {
        status: 401,
        headers
      });
    }
  }

  const responseBody = {
    "object": "billing_subscription",
    "has_payment_method": true,
    "canceled": false,
    "canceled_at": null,
    "delinquent": null,
    "access_until": 1826000000,
    "soft_limit": Math.round(hardLimitUsd * 100000),
    "hard_limit": Math.round(hardLimitUsd * 100000),
    "system_hard_limit": Math.round(hardLimitUsd * 100000),
    "soft_limit_usd": hardLimitUsd,
    "hard_limit_usd": hardLimitUsd,
    "system_hard_limit_usd": hardLimitUsd,
    "plan": {
      "title": "Developer",
      "id": "usage"
    },
    "account_name": "9Router User",
    "po_number": null,
    "billing_address": null,
    "payment_method_schema_version": 0,
    "primary_payment_method_status": "active"
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers
  });
}
