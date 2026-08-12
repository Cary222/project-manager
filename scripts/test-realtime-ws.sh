#!/bin/bash
# 测试 Realtime WebSocket 连接

set -e

API_KEY="${DASHSCOPE_API_KEY:-sk-sp-xxx}"
MODEL="qwen-audio-3.0-realtime-plus"
WS_URL="wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=${MODEL}&api_key=${API_KEY}"

echo "=== 测试 Realtime WebSocket ==="
echo "URL: ${WS_URL}"
echo ""
echo "使用 wscat 测试（需安装: npm i -g wscat）："
echo ""
echo "wscat -c '${WS_URL}'"
echo ""
echo "连接后发送 DashScope 格式消息（示例）："
echo '{"header":{"action":"audio_start","streaming":"duplex"}}'
echo ""
echo "⚠️  注意：DashScope Realtime 协议与 OpenAI Realtime 不同！"
echo "OpenAI 格式: {\"type\": \"input_audio_buffer.append\", \"audio\": \"...\"}"
echo "DashScope 格式: {\"header\": {\"action\": \"...\"}, \"payload\": {...}}"
