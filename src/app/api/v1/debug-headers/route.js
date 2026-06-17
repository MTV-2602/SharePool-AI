import { NextResponse } from "next/server";

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}

async function handle(request) {
  const headers = {};
  request.headers.forEach((value, key) => {
    // Mask API key for security
    if (key.toLowerCase() === "authorization" || key.toLowerCase() === "x-api-key" || key.toLowerCase() === "x-goog-api-key") {
      headers[key] = value.slice(0, 15) + "..." + value.slice(-5);
    } else {
      headers[key] = value;
    }
  });

  const { searchParams } = new URL(request.url);
  const params = {};
  searchParams.forEach((value, key) => {
    if (key.toLowerCase() === "key") {
      params[key] = value.slice(0, 15) + "..." + value.slice(-5);
    } else {
      params[key] = value;
    }
  });

  return NextResponse.json({
    url: request.url,
    method: request.method,
    headers,
    searchParams: params
  }, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}
