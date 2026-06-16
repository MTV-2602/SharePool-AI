'use strict';

const crypto = require('crypto');

const UNSUPPORTED_SCHEMA_CONSTRAINTS = [
  "minLength", "maxLength", "exclusiveMinimum", "exclusiveMaximum",
  "pattern", "minItems", "maxItems", "format",
  "default", "examples",
  "$schema", "$defs", "definitions", "const", "$ref", "$comment",
  "additionalProperties", "propertyNames", "patternProperties", "enumDescriptions",
  "anyOf", "oneOf", "allOf", "not",
  "dependencies", "dependentSchemas", "dependentRequired",
  "title", "if", "then", "else", "contentMediaType", "contentEncoding",
  "cornerRadius", "fillColor", "fontFamily", "fontSize", "fontWeight",
  "gap", "padding", "strokeColor", "strokeThickness", "textColor"
];

const ANTIGRAVITY_DEFAULT_SYSTEM = "You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.**Absolute paths only****Proactiveness**";

const AG_TOOL_SUFFIX = "_ide";

const AG_DEFAULT_TOOLS = new Set([
  "browser_subagent",
  "command_status",
  "find_by_name",
  "generate_image",
  "grep_search",
  "list_dir",
  "list_resources",
  "multi_replace_file_content",
  "notify_user",
  "read_resource",
  "read_terminal",
  "read_url_content",
  "replace_file_content",
  "run_command",
  "search_web",
  "send_command_input",
  "task_boundary",
  "view_content_chunk",
  "view_file",
  "write_to_file"
]);

// Decoy tools matching actual Antigravity tools
const AG_DECOY_TOOLS = [
  { name: "browser_subagent", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "command_status", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "find_by_name", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "generate_image", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "grep_search", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "list_dir", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "list_resources", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "multi_replace_file_content", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "notify_user", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "read_resource", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "read_terminal", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "read_url_content", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "replace_file_content", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "run_command", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "search_web", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "send_command_input", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "task_boundary", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "view_content_chunk", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "view_file", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } },
  { name: "write_to_file", description: "This tool is currently unavailable.", parameters: { type: "object", properties: {} } }
];

function sanitizeFunctionName(name) {
  if (!name) return "_unknown";
  let s = name.replace(/[^a-zA-Z0-9_.:\-]/g, "_");
  if (!/^[a-zA-Z_]/.test(s)) s = "_" + s;
  return s.substring(0, 64);
}

function generateProjectId() {
  const adjectives = ["useful", "bright", "swift", "calm", "bold"];
  const nouns = ["fuze", "wave", "spark", "flow", "core"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${crypto.randomUUID().slice(0, 5)}`;
}

function deriveSessionId(key) {
  if (!key) return crypto.randomUUID();
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function tryParseJSON(str) {
  if (typeof str !== "string") return str;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function removeUnsupportedKeywords(obj, keywords) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      removeUnsupportedKeywords(item, keywords);
    }
    return;
  }
  for (const key of Object.keys(obj)) {
    if (keywords.includes(key) || key.startsWith("x-")) {
      delete obj[key];
      continue;
    }
    const value = obj[key];
    if (value && typeof value === "object") {
      removeUnsupportedKeywords(value, keywords);
    }
  }
}

function convertConstToEnum(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.const !== undefined && !obj.enum) {
    obj.enum = [obj.const];
    delete obj.const;
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertConstToEnum(value);
    }
  }
}

function convertEnumValuesToStrings(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.enum && Array.isArray(obj.enum)) {
    obj.enum = obj.enum.map(v => String(v));
    if (!obj.type) {
      obj.type = "string";
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      convertEnumValuesToStrings(value);
    }
  }
}

function mergeAllOf(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.allOf && Array.isArray(obj.allOf)) {
    const merged = {};
    for (const item of obj.allOf) {
      if (item.properties) {
        if (!merged.properties) merged.properties = {};
        Object.assign(merged.properties, item.properties);
      }
      if (item.required && Array.isArray(item.required)) {
        if (!merged.required) merged.required = [];
        for (const req of item.required) {
          if (!merged.required.includes(req)) {
            merged.required.push(req);
          }
        }
      }
    }
    delete obj.allOf;
    if (merged.properties) obj.properties = { ...obj.properties, ...merged.properties };
    if (merged.required) obj.required = [...(obj.required || []), ...merged.required];
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      mergeAllOf(value);
    }
  }
}

function selectBest(items) {
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    let score = 0;
    const type = item.type;
    if (type === "object" || item.properties) {
      score = 3;
    } else if (type === "array" || item.items) {
      score = 2;
    } else if (type && type !== "null") {
      score = 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function flattenAnyOfOneOf(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.anyOf && Array.isArray(obj.anyOf) && obj.anyOf.length > 0) {
    const nonNullSchemas = obj.anyOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.anyOf;
      Object.assign(obj, selected);
    }
  }
  if (obj.oneOf && Array.isArray(obj.oneOf) && obj.oneOf.length > 0) {
    const nonNullSchemas = obj.oneOf.filter(s => s && s.type !== "null");
    if (nonNullSchemas.length > 0) {
      const bestIdx = selectBest(nonNullSchemas);
      const selected = nonNullSchemas[bestIdx];
      delete obj.oneOf;
      Object.assign(obj, selected);
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenAnyOfOneOf(value);
    }
  }
}

function flattenTypeArrays(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.type && Array.isArray(obj.type)) {
    const nonNullTypes = obj.type.filter(t => t !== "null");
    obj.type = nonNullTypes.length > 0 ? nonNullTypes[0] : "string";
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      flattenTypeArrays(value);
    }
  }
}

function ensureObjectType(obj) {
  if (!obj || typeof obj !== "object") return;
  if (obj.properties && !obj.type) obj.type = "object";
  for (const v of Object.values(obj)) if (v && typeof v === "object") ensureObjectType(v);
}

function cleanJSONSchemaForAntigravity(schema) {
  if (!schema || typeof schema !== "object") return schema;
  let cleaned = JSON.parse(JSON.stringify(schema)); // deep clone
  convertConstToEnum(cleaned);
  convertEnumValuesToStrings(cleaned);
  mergeAllOf(cleaned);
  flattenAnyOfOneOf(cleaned);
  flattenTypeArrays(cleaned);
  ensureObjectType(cleaned);
  removeUnsupportedKeywords(cleaned, UNSUPPORTED_SCHEMA_CONSTRAINTS);

  function cleanupRequired(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.required && Array.isArray(obj.required) && obj.properties) {
      const validRequired = obj.required.filter(field =>
        Object.prototype.hasOwnProperty.call(obj.properties, field)
      );
      if (validRequired.length === 0) {
        delete obj.required;
      } else {
        obj.required = validRequired;
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        cleanupRequired(value);
      }
    }
  }
  cleanupRequired(cleaned);

  function addPlaceholders(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.type === "object") {
      if (!obj.properties || Object.keys(obj.properties).length === 0) {
        obj.properties = {
          reason: {
            type: "string",
            description: "Brief explanation of why you are calling this tool"
          }
        };
        obj.required = ["reason"];
      }
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === "object") {
        addPlaceholders(value);
      }
    }
  }
  addPlaceholders(cleaned);

  return cleaned;
}

function convertOpenAIContentToParts(content) {
  const parts = [];
  if (typeof content === "string") {
    parts.push({ text: content });
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === "text") {
        parts.push({ text: item.text });
      } else if (item.type === "image_url" && item.image_url?.url?.startsWith("data:")) {
        const url = item.image_url.url;
        const commaIndex = url.indexOf(",");
        if (commaIndex !== -1) {
          const mimePart = url.substring(5, commaIndex);
          const data = url.substring(commaIndex + 1);
          const mimeType = mimePart.split(";")[0];
          parts.push({
            inlineData: { mime_type: mimeType, data: data }
          });
        }
      } else if (item.type === "image_url" && item.image_url?.url) {
        parts.push({
          fileData: { fileUri: item.image_url.url, mimeType: "image/*" }
        });
      }
    }
  }
  return parts;
}

function extractTextContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === "text").map(c => c.text).join("");
  }
  return "";
}

/**
 * Cloak and prepare tools for the Antigravity provider (anti-ban protection)
 */
function cloakTools(tools, contents) {
  if (!tools || tools.length === 0) {
    return { cloakedTools: null, toolNameMap: null, cloakedContents: contents };
  }

  const toolNameMap = new Map();
  const clientDeclarations = [];

  for (const toolGroup of tools) {
    const decls = toolGroup.functionDeclarations || toolGroup.functions || [];
    for (const func of decls) {
      if (AG_DEFAULT_TOOLS.has(func.name)) {
        clientDeclarations.push(func);
        continue;
      }
      const suffixed = `${func.name}${AG_TOOL_SUFFIX}`;
      toolNameMap.set(suffixed, func.name);
      clientDeclarations.push({
        ...func,
        name: suffixed,
        parameters: cleanJSONSchemaForAntigravity(func.parameters)
      });
    }
  }

  // Combine client tools with decoy tools to blend in
  const allDeclarations = [];
  const seenNames = new Set();
  for (const decl of [...clientDeclarations, ...AG_DECOY_TOOLS]) {
    if (!decl || !decl.name || seenNames.has(decl.name)) continue;
    seenNames.add(decl.name);
    allDeclarations.push(decl);
  }

  // Rewrite functionCall/functionResponse names in contents history
  const cloakedContents = contents?.map(msg => {
    if (!msg.parts) return msg;
    const cloakedParts = msg.parts.map(part => {
      if (part.functionCall && !AG_DEFAULT_TOOLS.has(part.functionCall.name)) {
        return {
          ...part,
          functionCall: {
            ...part.functionCall,
            name: `${part.functionCall.name}${AG_TOOL_SUFFIX}`
          }
        };
      }
      if (part.functionResponse && !AG_DEFAULT_TOOLS.has(part.functionResponse.name)) {
        return {
          ...part,
          functionResponse: {
            ...part.functionResponse,
            name: `${part.functionResponse.name}${AG_TOOL_SUFFIX}`
          }
        };
      }
      return part;
    });
    return { ...msg, parts: cloakedParts };
  });

  return {
    cloakedTools: allDeclarations.length > 0 ? [{ functionDeclarations: allDeclarations }] : null,
    toolNameMap,
    cloakedContents
  };
}

/**
 * Translates OpenAI Request to Antigravity Cloud Code Envelope
 */
function openaiToAntigravityRequest(model, body, stream, credentials = null) {
  const projectId = credentials?.projectId || generateProjectId();
  const email = credentials?.email || "default-user@gmail.com";

  // Build standard Gemini/Antigravity contents from messages
  let contents = [];
  let systemInstruction = null;

  if (body.messages && Array.isArray(body.messages)) {
    const tcID2Name = {};
    const toolResponses = {};

    // First pass to map tool calls and tool responses
    for (const msg of body.messages) {
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === "function" && tc.id && tc.function?.name) {
            tcID2Name[tc.id] = tc.function.name;
          }
        }
      }
      if (msg.role === "tool" && msg.tool_call_id) {
        toolResponses[msg.tool_call_id] = msg.content;
      }
    }

    // Convert messages to Gemini format
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const role = msg.role;
      const content = msg.content;

      if (role === "system") {
        systemInstruction = {
          role: "user",
          parts: [{ text: typeof content === "string" ? content : extractTextContent(content) }]
        };
      } else if (role === "user") {
        const parts = convertOpenAIContentToParts(content);
        if (parts.length > 0) {
          contents.push({ role: "user", parts });
        }
      } else if (role === "assistant") {
        const parts = [];
        if (msg.reasoning_content) {
          parts.push({ thought: true, text: msg.reasoning_content });
          parts.push({ thoughtSignature: "AAAAAA", text: "" }); // default signature
        }
        if (content) {
          const text = typeof content === "string" ? content : extractTextContent(content);
          if (text) {
            parts.push({ text });
          }
        }
        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
          const toolCallIds = [];
          for (const tc of msg.tool_calls) {
            if (tc.type !== "function") continue;
            parts.push({
              thoughtSignature: "AAAAAA",
              functionCall: {
                id: tc.id,
                name: sanitizeFunctionName(tc.function.name),
                args: tryParseJSON(tc.function.arguments || "{}")
              }
            });
            toolCallIds.push(tc.id);
          }
          if (parts.length > 0) {
            contents.push({ role: "model", parts });
          }

          // Check if there are tool responses in the history
          const hasResponses = toolCallIds.some(fid => toolResponses[fid]);
          if (hasResponses) {
            const toolParts = [];
            for (const fid of toolCallIds) {
              if (!toolResponses[fid]) continue;
              const name = tcID2Name[fid] || fid;
              let parsed = tryParseJSON(toolResponses[fid]);
              if (parsed === null || typeof parsed !== "object") {
                parsed = { result: toolResponses[fid] };
              }
              toolParts.push({
                functionResponse: {
                  id: fid,
                  name: sanitizeFunctionName(name),
                  response: { result: parsed }
                }
              });
            }
            if (toolParts.length > 0) {
              contents.push({ role: "user", parts: toolParts });
            }
          }
        } else if (parts.length > 0) {
          contents.push({ role: "model", parts });
        }
      }
    }
  }

  // Handle Cloak/Cloaking for tools
  let rawTools = [];
  if (body.tools && Array.isArray(body.tools)) {
    const decls = [];
    for (const t of body.tools) {
      if (t.type === "function" && t.function) {
        decls.push({
          name: sanitizeFunctionName(t.function.name),
          description: t.function.description || "",
          parameters: cleanJSONSchemaForAntigravity(t.function.parameters)
        });
      }
    }
    if (decls.length > 0) {
      rawTools = [{ functionDeclarations: decls }];
    }
  }

  const { cloakedTools, toolNameMap, cloakedContents } = cloakTools(rawTools, contents);

  // Generation Config
  const generationConfig = {
    temperature: body.temperature !== undefined ? body.temperature : 1.0,
    maxOutputTokens: body.max_tokens !== undefined ? body.max_tokens : 16384
  };
  if (body.top_p !== undefined) generationConfig.topP = body.top_p;
  if (body.top_k !== undefined) generationConfig.topK = body.top_k;

  // Reasoning / Thinking Config
  if (body.reasoning_effort) {
    const budgetMap = { low: 1024, medium: 8192, high: 32768 };
    const budget = budgetMap[body.reasoning_effort] || 8192;
    generationConfig.thinkingConfig = {
      thinkingBudget: budget,
      include_thoughts: true
    };
  }

  // System instruction double injection for Antigravity compatibility
  const systemParts = [
    { text: ANTIGRAVITY_DEFAULT_SYSTEM },
    { text: `Please ignore the following [ignore]${ANTIGRAVITY_DEFAULT_SYSTEM}[/ignore]` }
  ];

  if (systemInstruction && systemInstruction.parts) {
    systemInstruction.parts.unshift(...systemParts);
  } else {
    systemInstruction = { role: "user", parts: systemParts };
  }

  // Build enveloped payload
  const envelope = {
    project: projectId,
    model: model || "gemini-2.0-flash",
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${crypto.randomUUID()}`,
    request: {
      sessionId: deriveSessionId(email),
      contents: cloakedContents,
      systemInstruction,
      generationConfig,
      ...(cloakedTools && { tools: cloakedTools }),
      ...(cloakedTools && { toolConfig: { functionCallingConfig: { mode: "VALIDATED" } } })
    }
  };

  return { envelope, toolNameMap };
}

/**
 * Translates Antigravity Response to OpenAI Chunk Format
 */
function geminiToOpenAIResponse(chunk, state) {
  if (!chunk) return null;

  const response = chunk.response || chunk;
  if (!response || !response.candidates || !response.candidates[0]) return null;

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  // Initialize stream/response state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || "gemini-2.0-flash";
    state.functionIndex = 0;
    results.push({
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null
      }]
    });
  }

  // Process parts
  if (content && content.parts) {
    for (const part of content.parts) {
      const isThought = part.thought === true;

      // Thinking content
      if (isThought && part.text) {
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { reasoning_content: part.text },
            finish_reason: null
          }]
        });
      }

      // Regular Text
      if (part.text !== undefined && part.text !== "" && !isThought) {
        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { content: part.text },
            finish_reason: null
          }]
        });
      }

      // Function calls
      if (part.functionCall) {
        const rawName = part.functionCall.name;
        // Restore original tool name
        const fcName = state.toolNameMap instanceof Map && state.toolNameMap.has(rawName)
          ? state.toolNameMap.get(rawName)
          : rawName;
        const fcArgs = part.functionCall.args || {};
        const toolCallIndex = state.functionIndex++;

        const toolCall = {
          id: `call_${state.messageId}_${toolCallIndex}`,
          index: toolCallIndex,
          type: "function",
          function: {
            name: fcName,
            arguments: JSON.stringify(fcArgs)
          }
        };

        results.push({
          id: `chatcmpl-${state.messageId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: state.model,
          choices: [{
            index: 0,
            delta: { tool_calls: [toolCall] },
            finish_reason: null
          }]
        });
      }
    }
  }

  // Record usage metadata
  const usageMeta = response.usageMetadata;
  if (usageMeta && typeof usageMeta === "object") {
    const promptTokens = usageMeta.promptTokenCount || 0;
    const candidatesTokens = usageMeta.candidatesTokenCount || 0;
    const thoughtsTokens = usageMeta.thoughtsTokenCount || 0;
    const totalTokens = usageMeta.totalTokenCount || (promptTokens + candidatesTokens + thoughtsTokens);

    state.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: candidatesTokens + thoughtsTokens,
      total_tokens: totalTokens
    };
  }

  // Finish reason
  if (candidate.finishReason) {
    let finishReason = candidate.finishReason.toLowerCase();
    if (finishReason === "stop") {
      finishReason = state.functionIndex > 0 ? "tool_calls" : "stop";
    }

    const finalChunk = {
      id: `chatcmpl-${state.messageId}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: state.model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason
      }]
    };

    if (state.usage) {
      finalChunk.usage = state.usage;
    }

    results.push(finalChunk);
    state.finishReason = finishReason;
  }

  return results;
}

module.exports = {
  cleanJSONSchemaForAntigravity,
  openaiToAntigravityRequest,
  geminiToOpenAIResponse
};
