// 测试 AI SDK 的 ImagePart 格式转换
// 直接调用 generateText 来验证

import { generateText, openai } from 'ai';

async function test() {
  const model = openai('gpt-4o'); // 使用 OpenAI 作为参考
  
  try {
    const result = await generateText({
      model,
      messages: [
        { 
          role: 'user', 
          content: [
            { type: 'text', text: '这张图里有什么？' },
            { type: 'image', url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
          ] 
        }
      ],
      maxTokens: 100,
    });
    console.log('✅ OpenAI GPT-4o works with ImagePart:', result.text);
  } catch (e) {
    console.log('❌ OpenAI failed:', e.message);
  }
}

test();
