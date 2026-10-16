import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";
import { ROLE, RESPONSES_ITEM, GEMINI_ROLE, GEMINI_FINISH, OPENAI_FINISH } from "../../translator/schema/index.js";
import { openAICompletionToClaudeMessage } from "../../translator/concerns/claudeMessage.js";
import { openAICompletionToResponses } from "../../translator/concerns/responsesMessage.js";
import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";

// Responses-API providers (e.g. codex) may emit SSE without content-type + use Responses output shape
const isResponsesProvider = (p) => PROVIDERS[p]?.format === FORMATS.OPENAI_RESPONSES;

function textFromResponsesMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

/**
 * Codex / Responses API may emit many alternating reasoning + message items.
 * Early message blocks often have empty output_text; the user-visible answer is usually in the last non-empty message.
 */
function pickAssistantMessageForChatCompletion(output) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null, reasoningContent: null };
  const messages = output.filter((item) => item?.type === "message");
  let textContent = null;
  let msgItem = null;
  if (messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = textFromResponsesMessageItem(messages[i]);
      if (text.length > 0) {
        msgItem = messages[i];
        textContent = text;
        break;
      }
    }
    if (!msgItem) {
      msgItem = messages[messages.length - 1];
      textContent = textFromResponsesMessageItem(msgItem);
    }
  }

  let reasoningContent = null;
  const reasoningItems = output.filter((item) => item?.type === "reasoning");
  if (reasoningItems.length > 0) {
    const rParts = [];
    for (const rItem of reasoningItems) {
      if (Array.isArray(rItem.summary)) {
        for (const s of rItem.summary) {
          if (s?.text) rParts.push(s.text);
        }
      } else if (typeof rItem.reasoning === "string") {
        rParts.push(rItem.reasoning);
      }
    }
    if (rParts.length > 0) reasoningContent = rParts.join("\n");
  }

  return { msgItem, textContent, reasoningContent };
}

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const chunks = [];
  let streamError = null;
  let hasDone = false;

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      hasDone = true;
      continue;
    }
    if (!payload) continue;
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error) streamError = chunk.error;
      else chunks.push(chunk);
    } catch { /* ignore malformed lines */ }
  }

  if (streamError) return { error: streamError };
  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  const toolCallMap = new Map(); // index -> { id, type, function: { name, arguments } }
  let finishReason = null;
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    // Accumulate tool_calls from streaming deltas
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  // Fail-closed on truncated stream: must have either terminal [DONE] or a valid finish_reason
  if (!hasDone && !finishReason) {
    return {
      error: {
        status: 502,
        message: "Upstream SSE stream terminated prematurely without [DONE] or finish_reason"
      }
    };
  }

  const finalFinishReason = finishReason || (toolCallMap.size > 0 ? "tool_calls" : "stop");

  const message = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finalFinishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

export const isGeminiFormat = (fmt) =>
  fmt === FORMATS.ANTIGRAVITY ||
  fmt === FORMATS.GEMINI ||
  fmt === FORMATS.GEMINI_CLI ||
  fmt === FORMATS.VERTEX;

/**
 * Convert OpenAI Chat Completion to Gemini Candidates JSON format.
 * Preserves text, thoughts/reasoning, functionCall parts, and maps finishReason honestly.
 */
export function openAICompletionToGeminiResponse(chatCompletion, options = {}) {
  if (!chatCompletion?.choices?.[0]) return chatCompletion;

  const choice = chatCompletion.choices[0];
  const message = choice.message || {};
  const parts = [];

  // 1. Thinking / reasoning → thought part
  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content;
  if (reasoning) {
    parts.push({ thought: true, text: reasoning });
  }

  // 2. Text content
  if (typeof message.content === "string" && message.content.length > 0) {
    parts.push({ text: message.content });
  }

  // 3. Tool calls → functionCall parts
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let args = {};
      const rawArgs = tc.function?.arguments ?? tc.arguments;
      if (rawArgs && typeof rawArgs === "object") {
        args = rawArgs;
      } else if (typeof rawArgs === "string") {
        try {
          args = JSON.parse(rawArgs);
        } catch {
          args = {};
        }
      }
      parts.push({
        functionCall: {
          name: tc.function?.name || tc.name || "",
          args
        }
      });
    }
  }

  // If no parts at all, provide empty text
  if (parts.length === 0) {
    parts.push({ text: "" });
  }

  // 4. Truthful finish reason mapping
  const isIncomplete = options.isIncomplete ?? (choice.finish_reason === "incomplete");
  const incompleteReason = options.incompleteReason;
  let finishReason = null;

  if (isIncomplete) {
    if (incompleteReason === "max_output_tokens" || incompleteReason === "max_tokens" || choice.finish_reason === "length") {
      finishReason = GEMINI_FINISH.MAX_TOKENS;
    } else if (incompleteReason === "content_filter" || choice.finish_reason === "content_filter") {
      finishReason = GEMINI_FINISH.SAFETY;
    } else {
      // Unknown incomplete: do NOT fabricate STOP
      finishReason = null;
    }
  } else {
    finishReason = fromOpenAIFinish(choice.finish_reason, FORMATS.GEMINI);
  }

  const candidate = {
    content: {
      role: GEMINI_ROLE.MODEL,
      parts
    },
    index: choice.index ?? 0
  };
  if (finishReason !== null) {
    candidate.finishReason = finishReason;
  }

  // 5. Usage metadata
  const usage = chatCompletion.usage || {};
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (promptTokens + completionTokens);

  const usageMetadata = {
    promptTokenCount: promptTokens,
    candidatesTokenCount: completionTokens,
    totalTokenCount: totalTokens
  };

  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens
    ?? usage.output_tokens_details?.reasoning_tokens
    ?? usage.reasoning_tokens;
  if (typeof reasoningTokens === "number" && reasoningTokens >= 0) {
    usageMetadata.thoughtsTokenCount = reasoningTokens;
  }

  const cachedTokens = usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens
    ?? usage.cached_tokens;
  if (typeof cachedTokens === "number" && cachedTokens >= 0) {
    usageMetadata.cachedContentTokenCount = cachedTokens;
  }

  return {
    response: {
      candidates: [candidate],
      usageMetadata,
      modelVersion: chatCompletion.model || "unknown",
      responseId: chatCompletion.id || `resp_${Date.now()}`
    }
  };
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 */
export async function handleForcedSSEToJson({
  providerResponse, sourceFormat, targetFormat, provider, model, body, stream,
  translatedBody, finalBody, requestStartTime, connectionId, apiKey,
  clientRawRequest, onRequestSuccess, customToolNames, toolNameMap, trackDone, appendLog
}) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null; // not handled here

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  // Codex/Responses API SSE path
  // Branch on the UPSTREAM format (targetFormat = format we spoke to the provider in),
  // not the client format: a Responses-API client behind a chat-native forced-streaming
  // provider still receives chat SSE chunks, which must go through the standard path.
  const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body);

      // Fail-closed if upstream stream reported failure, error, or non-terminal EOF
      const isFailedOrError = !jsonResponse || jsonResponse.status === "failed" || Boolean(jsonResponse.error);
      const isTerminalContract = jsonResponse?.status === "completed" || jsonResponse?.status === "incomplete";

      if (isFailedOrError || !isTerminalContract) {
        const errorMsg = jsonResponse?.error?.message || "Upstream Responses stream failed";
        const upstreamStatus = Number(jsonResponse?.error?.status);
        const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
          ? upstreamStatus
          : HTTP_STATUS.BAD_GATEWAY;
        return createErrorResult(status, errorMsg);
      }

      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

      const { msgItem, textContent, reasoningContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: usage,
        response: { content: textContent, thinking: reasoningContent || null, finish_reason: jsonResponse.status || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      // Client is Responses API → return as-is
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(decloakToolNames(jsonResponse, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      // Build client-format response
      const inTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
      const outTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;

      // Extract tool calls from Responses API output (function_call items)
      const funcCallItems = (jsonResponse.output || []).filter(item => item.type === "function_call");
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;

      // Truthful finish reason mapping
      const isIncomplete = jsonResponse.status === "incomplete";
      const incompleteReason = jsonResponse.incomplete_details?.reason;
      let finishReason;
      if (isIncomplete && (incompleteReason === "max_output_tokens" || incompleteReason === "max_tokens")) {
        finishReason = "length";
      } else if (isIncomplete && incompleteReason === "content_filter") {
        finishReason = "content_filter";
      } else if (isIncomplete) {
        finishReason = incompleteReason || "incomplete";
      } else if (hasToolCalls) {
        finishReason = "tool_calls";
      } else {
        finishReason = "stop";
      }

      const message = { role: "assistant", content: textContent || (hasToolCalls ? null : "") };
      if (reasoningContent) message.reasoning_content = reasoningContent;
      if (hasToolCalls) message.tool_calls = toolCalls;

      const completionUsage = {
        ...usage,
        prompt_tokens: inTokens,
        completion_tokens: outTokens,
        total_tokens: usage.total_tokens || (inTokens + outTokens)
      };
      if (usage.input_tokens_details) {
        completionUsage.prompt_tokens_details = { ...usage.input_tokens_details };
      }
      if (usage.output_tokens_details) {
        completionUsage.completion_tokens_details = { ...usage.output_tokens_details };
      }

      let finalResp = {
        id: jsonResponse.id || `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
        model: jsonResponse.model || model,
        choices: [{ index: 0, message, finish_reason: finishReason }],
        usage: completionUsage
      };

      if (sourceFormat === FORMATS.CLAUDE) {
        finalResp = openAICompletionToClaudeMessage(finalResp);
      } else if (isGeminiFormat(sourceFormat)) {
        finalResp = openAICompletionToGeminiResponse(finalResp, { isIncomplete, incompleteReason });
      }

      return { success: true, response: new Response(JSON.stringify(decloakToolNames(finalResp, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error("[ChatCore] Responses API SSE→JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  // Standard Chat Completions SSE path
  try {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    if (parsed.error) {
      const upstreamStatus = Number(parsed.error.status);
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : HTTP_STATUS.BAD_GATEWAY;
      return createErrorResult(
        status,
        parsed.error.message || "Upstream SSE stream failed"
      );
    }
    if (!parsed.choices || parsed.choices.length === 0) {
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Upstream SSE stream produced no choices");
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    // Re-attach usage explicitly so caller always has usage
    if (usage && Object.keys(usage).length > 0) parsed.usage = usage;

    let finalBody;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
      finalBody = openAICompletionToResponses(parsed, customToolNames);
    } else if (sourceFormat === FORMATS.CLAUDE) {
      finalBody = openAICompletionToClaudeMessage(parsed);
    } else if (isGeminiFormat(sourceFormat)) {
      finalBody = openAICompletionToGeminiResponse(parsed);
    } else {
      finalBody = parsed;
    }

    // Strip reasoning_content for OpenAI clients only when content is non-empty.
    // When content is empty (e.g. thinking models that used all tokens for reasoning),
    // reasoning_content is the only useful output and must be preserved.
    if (sourceFormat === FORMATS.OPENAI && parsed?.choices) {
      for (const choice of parsed.choices) {
        if (choice?.message?.reasoning_content && choice.message.content) {
          delete choice.message.reasoning_content;
        }
      }
    }

    return { success: true, response: new Response(JSON.stringify(decloakToolNames(finalBody, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
