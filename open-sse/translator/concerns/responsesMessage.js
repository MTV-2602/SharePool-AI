import { ROLE, RESPONSES_ITEM } from "../schema/index.js";
import { OPENAI_FINISH } from "../schema/finishReasons.js";

function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

/**
 * Convert an OpenAI Chat Completions JSON body into the Responses API shape.
 * Shared concern used for non-streaming translation and forced SSE-to-JSON for Responses clients.
 *
 * Genuine protocol contracts:
 * - Truncated completion (choice.finish_reason === "length") maps to status "incomplete"
 *   with incomplete_details: { reason: "max_output_tokens" }.
 * - Completed completion maps to status "completed" with no incomplete_details.
 *
 * @param {object} responseBody - OpenAI chat completion object
 * @param {Set<string>|null} customToolNames - Optional set of custom tool names
 * @returns {object} Responses API response object
 */
export function openAICompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    const custom = customToolNames?.has(fn.name);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  let status = "completed";
  let incompleteDetails = null;

  if (choice.finish_reason === OPENAI_FINISH.LENGTH || choice.finish_reason === "length") {
    status = "incomplete";
    incompleteDetails = { reason: "max_output_tokens" };
  } else if (choice.finish_reason === OPENAI_FINISH.CONTENT_FILTER || choice.finish_reason === "content_filter") {
    status = "incomplete";
    incompleteDetails = { reason: "content_filter" };
  } else if (choice.finish_reason === "incomplete") {
    status = "incomplete";
    incompleteDetails = responseBody.incomplete_details || null;
  }

  const usage = responseBody.usage || {};
  const res = {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status,
    background: false,
    error: null,
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  };

  if (incompleteDetails) {
    res.incomplete_details = incompleteDetails;
  }

  return res;
}

export const chatCompletionToResponses = openAICompletionToResponses;
