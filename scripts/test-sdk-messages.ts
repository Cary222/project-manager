// 临时测试文件：测试 AI SDK 的消息格式
// 运行: npx ts-node --esm scripts/test-sdk-messages.ts

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

// 创建一个 mock provider 来打印实际发送的请求
const mockFetch = async (url: string, init: RequestInit) => {
  console.log('=== 请求 URL ===');
  console.log(url);
  console.log('=== 请求 Body ===');
  const body = JSON.parse(init.body as string);
  console.log(JSON.stringify(body.messages, null, 2));
  
  // 返回一个 mock 响应
  return new Response(JSON.stringify({
    id: 'test',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: 'Test response' },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

async function test() {
  const openai = createOpenAI({
    apiKey: 'test',
    baseURL: 'https://api.test.com/v1',
    fetch: mockFetch as any,
  });
  
  const model = openai('gpt-4o');
  
  console.log('\n=== Test 1: 标准 Text Part ===');
  try {
    await generateText({
      model,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] }
      ],
      maxTokens: 10,
    });
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  console.log('\n=== Test 2: Image Part (data URL) ===');
  try {
    await generateText({
      model,
      messages: [
        { 
          role: 'user', 
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
          ] 
        }
      ],
      maxTokens: 10,
    });
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  console.log('\n=== Test 3: File Part (data URL) ===');
  try {
    await generateText({
      model,
      messages: [
        { 
          role: 'user', 
          content: [
            { type: 'text', text: 'What is in this image?' },
            { 
              type: 'file', 
              data: { type: 'base64', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
              mediaType: 'image/png'
            }
          ] 
        }
      ],
      maxTokens: 10,
    });
  } catch (e) {
    console.log('Error:', e.message);
  }
}

test().catch(console.error);
