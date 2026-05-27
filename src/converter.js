// src/converter.js
// Chuyển đổi giữa format ChatGPT SSE và OpenAI API format

const { createParser } = require('eventsource-parser');

/**
 * Parse SSE stream từ ChatGPT và convert sang OpenAI streaming format
 * ChatGPT gửi full text tích lũy → cần tính delta
 */
async function* convertChatGPTStream(response, model) {
  const completionId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let previousText = '';
  let finished = false;

  // Chunk đầu tiên: role
  yield formatChunk(completionId, created, model, { role: 'assistant' }, null);

  const parser = createParser((event) => {
    // được xử lý trong vòng lặp bên dưới
  });

  // Đọc stream theo từng chunk
  for await (const chunk of response.body) {
    const text = chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();

      if (data === '[DONE]') {
        finished = true;
        break;
      }

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      // Lỗi từ ChatGPT
      if (parsed.error) {
        console.error('ChatGPT error:', parsed.error);
        break;
      }

      // Lấy text từ message
      const message = parsed.message;
      if (!message) continue;

      const status = message.status;
      const content = message.content;

      if (!content || content.content_type !== 'text') continue;
      const parts = content.parts;
      if (!parts || parts.length === 0) continue;

      const currentText = parts[0] || '';

      // Tính delta (phần mới so với lần trước)
      if (currentText.length > previousText.length) {
        const delta = currentText.slice(previousText.length);
        previousText = currentText;
        yield formatChunk(completionId, created, model, { content: delta }, null);
      }

      // Kết thúc
      if (status === 'finished_successfully') {
        finished = true;
        break;
      }
    }

    if (finished) break;
  }

  // Chunk kết thúc
  yield formatChunk(completionId, created, model, {}, 'stop');
  yield 'data: [DONE]\n\n';
}

function formatChunk(id, created, model, delta, finishReason) {
  const obj = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Đọc toàn bộ stream và trả về response object (non-streaming)
 */
async function collectFullResponse(response, model) {
  const completionId = `chatcmpl-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let finalText = '';

  for await (const chunk of response.body) {
    const text = chunk.toString('utf-8');
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      const message = parsed.message;
      if (!message) continue;

      const content = message.content;
      if (!content || content.content_type !== 'text') continue;

      const parts = content.parts;
      if (parts && parts.length > 0 && parts[0]) {
        finalText = parts[0]; // Luôn lấy text mới nhất (tích lũy)
      }
    }
  }

  return {
    id: completionId,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: finalText,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

module.exports = { convertChatGPTStream, collectFullResponse };
