'use strict';

const fetch = require('node-fetch');

const accessToken = `eyJhbGciOiJSUzI1NiIsImtpZCI6IjE5MzQ0ZTY1LWJiYzktNDRkMS1hOWQwLWY5NTdiMDc5YmQwZSIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfWDh6WTZ2VzJwUTl0UjNkRTduSzFqTDVnSCIsImV4cCI6MTc4MDgwNDc1OSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6ImJiOWIzYWMwLWM4YjUtNGY3ZC1iNTEyLWU5NWU5ZDM5YjJkNCIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3pfX2JiOWIzYWMwLWM4YjUtNGY3ZC1iNTEyLWU5NWU5ZDM5YjJkNCIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJmcmVlIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3oiLCJ1c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3oifSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9wcm9maWxlIjp7ImVtYWlsIjoidGVhbTg5YTZAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWV9LCJpYXQiOjE3Nzk5NDA3NTksImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwianRpIjoiNTEyMGVhNWYtOTRkZi00Mjc0LTg5YzItODYxNDZkMTQ2NzE4IiwibmJmIjoxNzc5OTQwNzU5LCJwd2RfYXV0aF90aW1lIjoxNzc5OTQwNzU4MTAwLCJzY3AiOlsib3BlbmlkIiwiZW1haWwiLCJwcm9maWxlIiwib2ZmbGluZV9hY2Nlc3MiLCJtb2RlbC5yZXF1ZXN0IiwibW9kZWwucmVhZCIsIm9yZ2FuaXphdGlvbi5yZWFkIiwib3JnYW5pemF0aW9uLndyaXRlIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc194OUUyU0UzV21FUDVOOGhQYkJZVnZrdTQiLCJzbCI6dHJ1ZSwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMDcxMzU2NzI3MDY4NTQxNjc3NjcifQ.JTgHwvDicHkrizHvsoR_tTTUXt6euEWGFI6CJ6Sc773UPQgnxfgo1dKAUmhMwzvX0xbkajHedVSlgBWtIMTO8ZgCGY9a4p5o1iZeiDBk--aFUNECsHdDspYEIQWvTN-Owhz-59YeHTWuajUJMwJFQMY8cwX5UM0NwOeIAYqEvbwCzVXjU3dv0IHjUQdbN4Ss3PQnH7ykMrRzYvd0AP3Diy8TiVInlvWQKxAmnM_LcRvywk4lidgGk2M7pKS5FMANWq5QKo_j96eaY6P3NLQMsskadSc88aCYrO6AU3TEwDGcuJ3D6gz3NX6Q_wxfWbxMqHI2T3WFdB2zahDs1BX2gRvcKeOm10jAzUm3kz6mPQshesrzqs9Fpa3aL4O45c2b-kbfZfr64_a9S7uHiMvW03YbyN3b649ihL-zuqFs5IzfkpGAVJ1A-ydvCRb1vt3WGqRm8hAu3Y_p8_ohAK0yRklL_vYYWoYnugXQDGk_V8eMFhGxrGYn1e4wwqEWpD5VkLeJ7A56fsgdwx-dFv7vogRqEjxQVn2gM4f-yQHqSbPgGnC7UIFf4yGsvfTopZMg2kYgtSNvJnGJRMvACFw8ji6L0-DGBUlAOMxBQYbS99Llequ8rWMCX0YZ8rmKZDtCMP1KnLQ5EaNpCme0eER-m0HcHKKc1jqI2oKmsZhceRg`;

const sessionCookie = `eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..y6871HhlzEl426v0.vZuXT-KJJNbFvNeu5ppZWbrA-wbMiw8b2HrCY-wXXW1MFX8ZvYDAyPY-8bKGdB2qJRZGfbJguI4cI9xQJRSOtXnCD4aDS_OqlLzEzKBxgas9HXV1sqTqaDuKzHlqN7Vnb8fBhiOh3expK9clGPryJtTfRh9jm4iNKQ-idf4ee2PE2ufXaSHc52srgOvKn6TJ6OjmAoNRGXyAXqFskQdLo-vBRr8S8WWDyVbtBT_gzxgrQjY9IMtP4tXsiedtuF0KfZ0psKk2RVUZmSKws0iRZUAdN_xMZlSRTX3VCUcyQRBKFieOiAPWN7M7JXG4FDHbh-f33tvvh_Njyi-nVmVP30kbu3z_I89h2zkcKuWYLiZ-HGK-nyh3-Z-YB1pCNc57Zq3hrsSdU_Hje7o0V_n7vm1CPL3x6SNX8pWAvwmBG8aq8br2LitLimPmrgSNEAQH0By5v_YKDQoSVjtNQzmo0vu_Bfl_fD7V5_p7aI1JR7_FSqToOtqL8WsNm_VxP4RlZ11cKiobU-wGMz6amAEQKWwX-fMp8ylJFCfFMmLSGtqrEgDaSqppFQNIfGPQ5RwXmJLTOa9bcLmwrS7q6PF9RkTwzcXhv8m5-rkWj9jxOUEYp3iT-jNQfTRPz6MWZvETYdh-nxb0ejxz05MFjl8GDDKAVMQmHNPqsqQ3QKgTu6k0dGCPV62mTaPPNg6-Pi5Ujei4L8b1Dlob8aQw3dGSVSnM1t3DCTencnVemQgELWA1YfFeCsWGhHYvodOFL29RLpx0YHKD95eFZotzoKIXmtWAv5j108dborHxEd4EPc7rJirIEOsYn3CnFn176xFSSeD_BP2_Q1RbBByc_kSYMQUAsUAWPSwYfTtDhC2F-G-hzQfFEoHU6GjLVPPalUSSU0EL80xF5YDa_lKo939m0463KnpJepO1u9WCwAMjwFuW49oKIhrK9cmFj9tPP-qQ95m`;

const body = {
  action: 'next',
  messages: [
    {
      id: 'turn-0',
      author: { role: 'user' },
      content: { content_type: 'text', parts: ['Hello'] },
      metadata: {}
    }
  ],
  model: 'gpt-4o',
  parent_message_id: 'aaa1' + Math.random().toString(36).slice(2),
  history_and_training_disabled: true,
  conversation_mode: { kind: 'primary_assistant' },
  force_paragen: false,
  force_paragen_model_slug: '',
  force_nulligen: false,
  force_rate_limit: false
};

async function test(useCookie) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://chatgpt.com/',
    'Origin': 'https://chatgpt.com'
  };
  
  if (useCookie) {
    headers['Cookie'] = `__Secure-next-auth.session-token=${sessionCookie}`;
  }
  
  console.log(`\nTesting with useCookie = ${useCookie}...`);
  try {
    const res = await fetch('https://chatgpt.com/backend-api/conversation', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    console.log('Status:', res.status);
    const text = await res.text();
    console.log('Body snippet:', text.substring(0, 500));
  } catch (err) {
    console.error('Request failed:', err);
  }
}

async function run() {
  await test(false);
  await test(true);
}

run();
