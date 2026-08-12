#!/bin/bash
# 测试 Token Plan MaaS 语音 API

set -e

API_KEY="${DASHSCOPE_API_KEY:-sk-sp-xxx}"
BASE_URL="https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1"

echo "=== 测试 1: 获取模型列表 ==="
curl -s "${BASE_URL}/models" \
  -H "Authorization: Bearer ${API_KEY}" | jq -r '.data[] | select(.id | contains("audio")) | .id' || echo "❌ /models 端点失败"

echo -e "\n=== 测试 2: TTS API ==="
curl -s -X POST "${BASE_URL}/services/audio/tts/SpeechSynthesizer" \
  -H "Authorization: Bearer ${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-audio-3.0-tts-plus",
    "input": {
      "text": "你好",
      "voice": "longanhuan_v3.6",
      "format": "mp3",
      "sample_rate": 24000
    }
  }' \
  -o /tmp/tts-test.mp3 && echo "✅ TTS 成功，输出: /tmp/tts-test.mp3" || echo "❌ TTS 失败"

echo -e "\n=== 测试 3: Realtime WebSocket URL 验证 ==="
WS_URL="wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=qwen-audio-3.0-realtime-plus&api_key=${API_KEY}"
echo "WebSocket URL: ${WS_URL}"
echo "⚠️  需要手动测试 WebSocket 连接（浏览器 DevTools 或 wscat）"

echo -e "\n=== 测试 4: 检查 STT 端点 ==="
echo "Token Plan MaaS 可能的 STT 端点："
echo "  - POST ${BASE_URL}/services/audio/asr/transcription"
echo "  - 或需要异步轮询 /tasks/{id}"
