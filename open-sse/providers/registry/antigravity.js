import { ANTIGRAVITY_OAUTH_CLIENT, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_BASE_URL } from "../shared.js";

export default {
  id: "antigravity",
  priority: 20,
  alias: "ag",
  uiAlias: "ag",
  display: {
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    website: "https://antigravity.google",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  serviceKinds: ["llm", "image"],
  transport: {
    baseUrls: [
      ANTIGRAVITY_IDE_BASE_URL,
    ],
    format: "antigravity",
    headers: {
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    },
    retry: {
      "429": {
        attempts: 3,
      },
      "500": {
        attempts: 3,
      },
      "503": {
        attempts: 3,
      },
    },
    usage: {
      quotaApiUrl: `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:fetchAvailableModels`,
      quotaSummaryApiUrl: `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:retrieveUserQuotaSummary`,
      loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    ...ANTIGRAVITY_OAUTH_CLIENT,
  },
  models: [
    // ── Upstream Antigravity IDE models + Thinking variants ──────────────────
    { id: "gemini-3-flash",              name: "Gemini 3 Flash",              upstreamModelId: "gemini-3-flash" },
    { id: "gemini-3-flash-agent",        name: "Gemini 3 Flash Agent",        upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3-flash(high)",        name: "Gemini 3 Flash (High)",       upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3-flash(medium)",      name: "Gemini 3 Flash (Medium)",     upstreamModelId: "gemini-3.8-flash-medium" },
    { id: "gemini-3-flash(low)",         name: "Gemini 3 Flash (Low)",        upstreamModelId: "gemini-3.8-flash-low" },
    { id: "gemini-3.1-flash-lite",       name: "Gemini 3.1 Flash Lite",       upstreamModelId: "gemini-3.1-flash-lite" },
    { id: "gemini-3.1-pro(high)",        name: "Gemini 3.1 Pro (High)",       upstreamModelId: "gemini-pro-agent" },
    { id: "gemini-3.1-pro(low)",         name: "Gemini 3.1 Pro (Low)",        upstreamModelId: "gemini-3.1-pro-low" },
    { id: "gemini-3.1-pro-high",         name: "Gemini 3.1 Pro High",         upstreamModelId: "gemini-pro-agent" },
    { id: "gemini-3.1-pro-low",          name: "Gemini 3.1 Pro Low",          upstreamModelId: "gemini-3.1-pro-low" },
    { id: "gemini-pro-agent",            name: "Gemini Pro Agent",            upstreamModelId: "gemini-pro-agent" },
    // ── Claude 5.5 (Mới nhất) ────────────────────────────────────────────────
    { id: "claude-sonnet-5-5-high",      name: "Claude Sonnet 5.5 (High)",      upstreamModelId: "claude-sonnet-5-5-high" },
    { id: "claude-sonnet-5-5",           name: "Claude Sonnet 5.5",             upstreamModelId: "claude-sonnet-5-5-high" },
    { id: "claude-sonnet-5.5",           name: "Claude Sonnet 5.5",             upstreamModelId: "claude-sonnet-5-5-high" },
    { id: "claude-sonnet-5-5-medium",    name: "Claude Sonnet 5.5 (Medium)",    upstreamModelId: "claude-sonnet-5-5-medium" },
    { id: "claude-sonnet-5-5-low",       name: "Claude Sonnet 5.5 (Low)",       upstreamModelId: "claude-sonnet-5-5-low" },
    { id: "claude-opus-5-5-high",        name: "Claude Opus 5.5 (High)",        upstreamModelId: "claude-opus-5-5-high" },
    { id: "claude-opus-5-5",             name: "Claude Opus 5.5",               upstreamModelId: "claude-opus-5-5-high" },
    { id: "claude-opus-5.5",             name: "Claude Opus 5.5",               upstreamModelId: "claude-opus-5-5-high" },
    { id: "claude-opus-5-5-medium",      name: "Claude Opus 5.5 (Medium)",      upstreamModelId: "claude-opus-5-5-medium" },
    { id: "claude-opus-5-5-low",         name: "Claude Opus 5.5 (Low)",         upstreamModelId: "claude-opus-5-5-low" },

    // ── Tương thích ngược Claude 4.6 (Auto -> 5.5) ───────────────────────────
    { id: "claude-sonnet-4-6",           name: "Claude Sonnet 4.6 (Auto -> 5.5)", upstreamModelId: "claude-sonnet-5-5-high" },
    { id: "claude-opus-4-6-thinking",    name: "Claude Opus 4.6 (Auto -> 5.5)",   upstreamModelId: "claude-opus-5-5-high" },
    { id: "gpt-oss-120b-medium",         name: "GPT-OSS 120B (Medium)" },

    // ── Alias 3.8 (mặc định chính cho khách hàng) ────────────────────────────
    { id: "gemini-3.8-flash-high",       name: "Gemini 3.8 Flash (High)",     upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3.8-flash",            name: "Gemini 3.8 Flash",            upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3.8-flash-medium",     name: "Gemini 3.8 Flash (Medium)",   upstreamModelId: "gemini-3.8-flash-medium" },
    { id: "gemini-3.8-flash-low",        name: "Gemini 3.8 Flash (Low)",      upstreamModelId: "gemini-3.8-flash-low" },
    { id: "gemini-3.8-flash-tiered",     name: "Gemini 3.8 Flash (Tiered)",   upstreamModelId: "gemini-3.8-flash-tiered" },

    // ── Alias 3.7 (tương thích ngược cho khách hàng đang gọi) ────────────────
    { id: "gemini-3.7-flash-high",       name: "Gemini 3.7 Flash (High)",     upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3.7-flash",            name: "Gemini 3.7 Flash",            upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3.7-flash-medium",     name: "Gemini 3.7 Flash (Medium)",   upstreamModelId: "gemini-3.8-flash-medium" },
    { id: "gemini-3.7-flash-low",        name: "Gemini 3.7 Flash (Low)",      upstreamModelId: "gemini-3.8-flash-low" },

    // ── Image generation ──────────────────────────────────────────────────────
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash (Image)", kind: "image", imageGen: true, capabilities: ["textToImage"] },
  ],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    apiEndpoint: ANTIGRAVITY_IDE_BASE_URL,
    apiVersion: "v1internal",
    // Keep loadCodeAssist/onboardUser on prod cloudcode-pa (daily endpoint has stricter rate limit on onboarding)
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    loadCodeAssistUserAgent: ANTIGRAVITY_IDE_USER_AGENT,
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};

