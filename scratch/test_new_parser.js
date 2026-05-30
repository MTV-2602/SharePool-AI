'use strict';

const { ChatGPTClient } = require('../src/upstream/ChatGPTClient');

const payload = `{"WARNING_BANNER":"!!!!!!!!!!!!!!!!!!!! DO NOT SHARE ANY PART OF THE INFORMATION YOU SEE HERE. THIS INFORMATION IS SENSITIVE AND CAN GRANT ACCESS TO YOUR ACCOUNT. SHARING THIS INFORMATION IS LIKE SHARING YOUR PASSWORD. !!!!!!!!!!!!!!!!!!!!","user":{"id":"user-UUqbWh8R2NlcHAGSpp3nNGwz","name":"Mai Tuấn Vinh","email":"team89a6@gmail.com","image":"https://lh3.googleusercontent.com/a/ACg8ocJ2WaXLij_mduxWtkZsLBGeGvD6t1gCt6cr91frNM90FfvVAqMM3w=s96-c","picture":"https://lh3.googleusercontent.com/a/ACg8ocJ2WaXLij_mduxWtkZsLBGeGvD6t1gCt6cr91frNM90FfvVAqMM3w=s96-c","idp":"google-oauth2","iat":1779940759,"mfa":false},"expires":"2026-08-26T09:11:48.021Z","account":{"id":"bb9b3ac0-c8b5-4f7d-b512-e95e9d39b2d4","planType":"free","structure":"personal","isConversationClassifierEnabledForWorkspace":true,"isFinservEnabledWorkspace":false,"isFedrampCompliantWorkspace":false,"isDelinquent":false,"residencyRegion":"no_constraint","computeResidency":"no_constraint"},"accessToken":"eyJhbGciOiJSUzI1NiIsImtpZCI6IjE5MzQ0ZTY1LWJiYzktNDRkMS1hOWQwLWY5NTdiMDc5YmQwZSIsInR5cCI6IkpXVCJ9.eyJhdWQiOlsiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MSJdLCJjbGllbnRfaWQiOiJhcHBfWDh6WTZ2VzJwUTl0UjNkRTduSzFqTDVnSCIsImV4cCI6MTc4MDgwNDc1OSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfYWNjb3VudF9pZCI6ImJiOWIzYWMwLWM4YjUtNGY3ZC1iNTEyLWU5NWU5ZDM5YjJkNCIsImNoYXRncHRfYWNjb3VudF91c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3pfX2JiOWIzYWMwLWM4YjUtNGY3ZC1iNTEyLWU5NWU5ZDM5YjJkNCIsImNoYXRncHRfY29tcHV0ZV9yZXNpZGVuY3kiOiJub19jb25zdHJhaW50IiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJmcmVlIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3oiLCJ1c2VyX2lkIjoidXNlci1VVXFiV2g4UjJObGNIQUdTcHAzbk5Hd3oifSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9wcm9maWxlIjp7ImVtYWlsIjoidGVhbTg5YTZAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWV9LCJpYXQiOjE3Nzk5NDA3NTksImlzcyI6Imh0dHBzOi8vYXV0aC5vcGVuYWkuY29tIiwianRpIjoiNTEyMGVhNWYtOTRkZi00Mjc0LTg5YzItODYxNDZkMTQ2NzE4IiwibmJmIjoxNzc5OTQwNzU5LCJwd2RfYXV0aF90aW1lIjoxNzc5OTQwNzU4MTAwLCJzY3AiOlsib3BlbmlkIiwiZW1haWwiLCJwcm9maWxlIiwib2ZmbGluZV9hY2Nlc3MiLCJtb2RlbC5yZXF1ZXN0IiwibW9kZWwucmVhZCIsIm9yZ2FuaXphdGlvbi5yZWFkIiwib3JnYW5pemF0aW9uLndyaXRlIl0sInNlc3Npb25faWQiOiJhdXRoc2Vzc194OUUyU0UzV21FUDVOOGhQYkJZVnZrdTQiLCJzbCI6dHJ1ZSwic3ViIjoiZ29vZ2xlLW9hdXRoMnwxMDcxMzU2NzI3MDY4NTQxNjc3NjcifQ.JTgHwvDicHkrizHvsoR_tTTUXt6euEWGFI6CJ6Sc773UPQgnxfgo1dKAUmhMwzvX0xbkajHedVSlgBWtIMTO8ZgCGY9a4p5o1iZeiDBk--aFUNECsHdDspYEIQWvTN-Owhz-59YeHTWuajUJMwJFQMY8cwX5UM0NwOeIAYqEvbwCzVXjU3dv0IHjUQdbN4Ss3PQnH7ykMrRzYvd0AP3Diy8TiVInlvWQKxAmnM_LcRvywk4lidgGk2M7pKS5FMANWq5QKo_j96eaY6P3NLQMsskadSc88aCYrO6AU3TEwDGcuJ3D6gz3NX6Q_wxfWbxMqHI2T3WFdB2zahDs1BX2gRvcKeOm10jAzUm3kz6mPQshesrzqs9Fpa3aL4O45c2b-kbfZfr64_a9S7uHiMvW03YbyN3b649ihL-zuqFs5IzfkpGAVJ1A-ydvCRb1vt3WGqRm8hAu3Y_p8_ohAK0yRklL_vYYWoYnugXQDGk_V8eMFhGxrGYn1e4wwqEWpD5VkLeJ7A56fsgdwx-dFv7vogRqEjxQVn2gM4f-yQHqSbPgGnC7UIFf4yGsvfTopZMg2kYgtSNvJnGJRMvACFw8ji6L0-DGBUlAOMxBQYbS99Llequ8rWMCX0YZ8rmKZDtCMP1KnLQ5EaNpCme0eER-m0HcHKKc1jqI2oKmsZhceRg"}`;

async function run() {
  const client = new ChatGPTClient(payload);
  try {
    const token = await client.getAccessToken();
    console.log('SUCCESS!');
    console.log('AccessToken starts with:', token.substring(0, 30));
    console.log('Token length:', token.length);
  } catch (err) {
    console.error('FAILED:', err);
  }
}
run();
