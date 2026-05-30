'use strict';

const { Readable } = require('stream');
const Converter = require('../src/upstream/Converter');

async function main() {
  console.log('Starting stream conversion test...');

  // Create a mock stream that outputs Codex Responses API SSE events
  const mockStream = new Readable({
    read() {}
  });

  const responseMock = {
    isCodex: true,
    body: mockStream
  };

  // Push some mock events
  // Event 1: response.created
  mockStream.push('event: response.created\n');
  mockStream.push('data: {"type": "response.created", "response": {"id": "resp_123", "object": "response"}}\n\n');

  // Event 2: output delta
  mockStream.push('event: response.output_text.delta\n');
  mockStream.push('data: {"type": "response.output_text.delta", "delta": "Hello"}\n\n');

  // Event 3: reasoning content (thinking)
  mockStream.push('event: response.reasoning_summary_text.delta\n');
  mockStream.push('data: {"type": "response.reasoning_summary_text.delta", "delta": "Thinking..."}\n\n');

  // Event 4: output delta 2
  mockStream.push('event: response.output_text.delta\n');
  mockStream.push('data: {"type": "response.output_text.delta", "delta": " world!"}\n\n');

  // Event 5: response.completed
  mockStream.push('event: response.completed\n');
  mockStream.push('data: {"type": "response.completed"}\n\n');
  
  // Close stream
  mockStream.push(null);

  console.log('Consuming Converter.streamToOpenAI...');
  const chunks = [];
  try {
    for await (const chunk of Converter.streamToOpenAI(responseMock, 'gpt-4o', 'chatcmpl-test')) {
      chunks.push(chunk);
      console.log('YIELDED CHUNK:', JSON.stringify(chunk));
    }
  } catch (err) {
    console.error('Stream processing failed:', err);
    process.exit(1);
  }

  console.log('\nAsserting chunks...');
  
  // Check the chunks returned
  // First chunk should be role assistant
  if (!chunks[0].includes('"role":"assistant"')) {
    throw new Error('Test failed: first chunk is not the role chunk!');
  }
  
  // Second chunk should contain "Hello"
  if (!chunks[1].includes('"content":"Hello"')) {
    throw new Error('Test failed: missing or incorrect "Hello" content chunk!');
  }

  // Third chunk should contain "Thinking..." reasoning_content
  if (!chunks[2].includes('"reasoning_content":"Thinking..."')) {
    throw new Error('Test failed: missing or incorrect reasoning content chunk!');
  }

  // Fourth chunk should contain " world!"
  if (!chunks[3].includes('"content":" world!"')) {
    throw new Error('Test failed: missing or incorrect " world!" content chunk!');
  }

  // Fifth chunk should have finish_reason: stop
  if (!chunks[4].includes('"finish_reason":"stop"')) {
    throw new Error('Test failed: missing or incorrect stop chunk!');
  }

  // Sixth chunk should be [DONE]
  if (chunks[5] !== 'data: [DONE]\n\n') {
    throw new Error('Test failed: missing [DONE] sentinel!');
  }

  console.log('✅ Stream conversion assertions passed successfully!');
  console.log('Test completed successfully! 🎉');
}

main().catch(console.error);
