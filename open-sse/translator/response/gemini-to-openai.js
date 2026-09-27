import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { ROLE, OPENAI_BLOCK, OPENAI_FINISH, DEFAULT_IMAGE_MIME } from "../schema/index.js";
import { buildChunk } from "../concerns/chunk.js";
import { toOpenAIUsage } from "../concerns/usage.js";
import { reasoningDelta } from "../concerns/reasoning.js";
import { encodeDataUri } from "../concerns/image.js";
import { toOpenAIFinish } from "../concerns/finishReason.js";
import { storeGeminiThoughtSignature } from "../../services/thoughtSignatureStore.js";

// Build chunk meta for current gemini state
function chunkMeta(state) {
  return { id: `chatcmpl-${state.messageId}`, created: Math.floor(Date.now() / 1000), model: state.model };
}

// Build a tool_call chunk from a gemini functionCall part (shared by sig/non-sig branches)
function emitFunctionCall(functionCall, state, signature = null) {
  const rawName = functionCall.name;
  // Restore original tool name from mapping (AG cloaking)
  const fcName = state.toolNameMap?.get(rawName) || rawName;
  const fcArgs = functionCall.args || {};
  const toolCallIndex = state.functionIndex++;
  const callId = functionCall.id || `${fcName}-${Date.now()}-${toolCallIndex}`;
  if (signature) {
    storeGeminiThoughtSignature(callId, signature, state.sessionId, state.model);
  }
  const toolCall = {
    id: callId,
    index: toolCallIndex,
    type: OPENAI_BLOCK.FUNCTION,
    function: { name: fcName, arguments: JSON.stringify(fcArgs) },
  };
  // Keep Gemini bookkeeping separate from the shared translator state.toolCalls map.
  // The downstream OpenAI→Claude translator uses state.toolCalls for Claude block
  // metadata; pre-populating it here makes Anthropic tool deltas lose index.
  state.geminiToolCallCount = (state.geminiToolCallCount || 0) + 1;
  return buildChunk(chunkMeta(state), { tool_calls: [toolCall] }, null);
}

// Convert Gemini response chunk to OpenAI format
export function geminiToOpenAIResponse(chunk, state) {
  // Handle stream EOF flush: ensure finish_reason is emitted if upstream closed without one
  if (!chunk) {
    if (state?.messageId && !state.finishReason) {
      const flushResults = [];
      if (!state.geminiEmittedContent && (state.geminiToolCallCount || 0) === 0 && state.geminiReasoningBuffer) {
        flushResults.push(buildChunk(chunkMeta(state), { content: state.geminiReasoningBuffer }, null));
        state.geminiEmittedContent = true;
      }
      const finishReason = (state.geminiToolCallCount || 0) > 0 ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP;
      const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
      if (state.usage) finalChunk.usage = state.usage;
      flushResults.push(finalChunk);
      state.finishReason = finishReason;
      return flushResults;
    }
    return null;
  }
  
  // Handle Antigravity wrapper
  const response = chunk.response || chunk;
  if (!response) return null;

  // Extract usage metadata even if candidates is absent on a trailing usage chunk
  const usageMeta = response.usageMetadata || chunk.usageMetadata;
  const geminiUsage = toOpenAIUsage(usageMeta, "gemini");
  if (geminiUsage) state.usage = geminiUsage;

  if (!response.candidates?.[0]) return null;

  const results = [];
  const candidate = response.candidates[0];
  const content = candidate.content;

  // Initialize state
  if (!state.messageId) {
    state.messageId = response.responseId || `msg_${Date.now()}`;
    state.model = response.modelVersion || state.model || "gemini";
    state.functionIndex = 0;
    state.geminiToolCallCount = 0;
    state.geminiEmittedContent = false;
    state.geminiReasoningBuffer = "";
    results.push(buildChunk(chunkMeta(state), { role: ROLE.ASSISTANT }, null));
  }

  // Process parts
  if (content?.parts) {
    for (const part of content.parts) {
      const hasThoughtSig = part.thoughtSignature || part.thought_signature;
      if (hasThoughtSig && typeof hasThoughtSig === "string") {
        state.pendingThoughtSignature = hasThoughtSig;
      }
      const isThought = part.thought === true;

      // Handle thought signature (thinking mode)
      if (hasThoughtSig) {
        const hasTextContent = part.text !== undefined && part.text !== "";
        const hasFunctionCall = !!part.functionCall;

        // Standalone thoughtSignature part (no text, no functionCall): keep pending for next functionCall
        if (!hasTextContent && !hasFunctionCall) {
          continue;
        }

        if (hasTextContent) {
          if (isThought) {
            state.geminiReasoningBuffer = (state.geminiReasoningBuffer || "") + part.text;
          } else {
            state.geminiEmittedContent = true;
          }
          results.push(buildChunk(
            chunkMeta(state),
            isThought ? reasoningDelta(part.text) : { content: part.text },
            null
          ));
        }

        if (hasFunctionCall) {
          results.push(emitFunctionCall(part.functionCall, state, hasThoughtSig));
          state.pendingThoughtSignature = null;
        }
        continue;
      }

      // Text content. Gemini marks model-internal thinking with `thought: true`.
      // Some responses include a thoughtSignature, but Google AI Studio/Gemini API
      // can also stream thought parts without a signature; those must not be
      // surfaced as normal assistant content in OpenAI-compatible clients.
      if (part.text !== undefined && part.text !== "") {
        if (isThought) {
          state.geminiReasoningBuffer = (state.geminiReasoningBuffer || "") + part.text;
        } else {
          state.geminiEmittedContent = true;
        }
        results.push(buildChunk(
          chunkMeta(state),
          isThought ? reasoningDelta(part.text) : { content: part.text },
          null
        ));
      }

      // Function call
      if (part.functionCall) {
        const sig = state.pendingThoughtSignature || null;
        results.push(emitFunctionCall(part.functionCall, state, sig));
        state.pendingThoughtSignature = null;
      }

      // Inline data (images)
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        state.geminiEmittedContent = true;
        const mimeType = inlineData.mimeType || inlineData.mime_type || DEFAULT_IMAGE_MIME;
        results.push(buildChunk(
          chunkMeta(state),
          {
            images: [{
              type: OPENAI_BLOCK.IMAGE_URL,
              image_url: { url: encodeDataUri(mimeType, inlineData.data) }
            }]
          },
          null
        ));
      }
    }
  }

  // Finish reason - include usage in final chunk
  if (candidate.finishReason) {
    let finishReason = toOpenAIFinish(candidate.finishReason, "gemini");
    if (finishReason === OPENAI_FINISH.STOP && state.geminiToolCallCount > 0) {
      finishReason = OPENAI_FINISH.TOOL_CALLS;
    }

    // If Gemini stopped after emitting only thinking/reasoning (0 candidate tokens and 0 tool calls),
    // also surface the reasoning text as assistant content so clients like Kilo Code / Cline / Roo Code
    // do not fail the turn with "Response ended unexpectedly and may be incomplete."
    if (!state.geminiEmittedContent && (state.geminiToolCallCount || 0) === 0 && state.geminiReasoningBuffer) {
      results.push(buildChunk(chunkMeta(state), { content: state.geminiReasoningBuffer }, null));
      state.geminiEmittedContent = true;
    }
    
    const finalChunk = buildChunk(chunkMeta(state), {}, finishReason);
    
    // Include usage in final chunk for downstream translators
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    
    results.push(finalChunk);
    state.finishReason = finishReason;
  }

  return results.length > 0 ? results : null;
}

// Register
register(FORMATS.GEMINI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.GEMINI_CLI, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.ANTIGRAVITY, FORMATS.OPENAI, null, geminiToOpenAIResponse);
register(FORMATS.VERTEX, FORMATS.OPENAI, null, geminiToOpenAIResponse);


