#!/usr/bin/env bash
# Agnes API 连通性诊断 — 区分 GFW / 本机防火墙 / Cloudflare 节点宕机
# 用法: bash scripts/diag-agnes-api.sh
set -uo pipefail

KEY="${OPENAI_API_KEY:-sk-IlFCiW2jBgJmJ21hL9YASZDGPzlmgorVoDM3QPuEezU84W6O}"
HOSTS=(
  "apihub.agnes-ai.com"
  "platform.agnes-ai.com"
  "agnes-ai.com"
)
PORT=443

ok()  { printf "  \033[32m%s\033[0m %s\n" "✓" "$*"; }
bad() { printf "  \033[31m%s\033[0m %s\n" "✗" "$*"; }
hdr() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }

hdr "0. 环境信息"
echo "  本机公网出口 IP:"
curl -s --max-time 5 https://api.ipify.org 2>/dev/null || echo "  (无法获取)"
echo "  本机 DNS:"
scutil --dns 2>/dev/null | grep -E "nameserver\[" | head -4 | sed 's/^/    /'
echo "  Key 前缀: ${KEY:0:7}...${KEY: -4}"

for h in "${HOSTS[@]}"; do
  hdr "1. DNS 解析 $h"
  ips=$(dig +short +time=3 "$h" 2>/dev/null | tr '\n' ' ')
  if [[ -n "$ips" ]]; then
    ok "$h → $ips"
  else
    bad "$h 解析失败"
    continue
  fi

  hdr "2. TCP 握手 $h:$PORT (3s timeout)"
  if nc -vz -w 3 "$h" $PORT 2>&1 | grep -q succeeded; then
    ok "$h:$PORT 可达"
  else
    bad "$h:$PORT 超时/拒绝"
    # 拿到 IP 就再直连 IP
    for ip in $ips; do
      echo "    尝试直连 IP $ip..."
      if nc -vz -w 3 "$ip" $PORT 2>&1 | grep -q succeeded; then
        ok "  直连 $ip:$PORT 可达 (说明是域名被拦或 CDN 选路问题)"
      else
        bad "  直连 $ip:$PORT 也超时"
      fi
    done
  fi

  hdr "3. TLS 握手 $h (5s)"
  if openssl s_client -connect "$h:$PORT" -servername "$h" </dev/null 2>&1 | grep -q "BEGIN CERTIFICATE"; then
    ok "TLS 证书可读取"
  else
    bad "TLS 握手失败 (TCP 通但被 RST/中断)"
  fi
done

hdr "4. 直连 Cloudflare 美国节点 (绕过 DNS)"
CF_IPS=("1.1.1.1" "8.8.8.8" "69.63.187.12")
for ip in "${CF_IPS[@]}"; do
  if nc -vz -w 3 "$ip" 443 2>&1 | grep -q succeeded; then
    ok "$ip:443 可达 (Cloudflare 网络通)"
  else
    bad "$ip:443 超时 (到 Cloudflare 节点链路有问题)"
  fi
done

hdr "5. 复现 AI_APICallError — 调用 /v1/models"
echo "  POST https://apihub.agnes-ai.com/v1/models  (timeout=10s)"
curl -sS --max-time 10 -o /tmp/agnes-resp.txt -w "  HTTP %{http_code} | %{time_total}s | %{errormsg}\n" \
  -H "Authorization: Bearer $KEY" \
  https://apihub.agnes-ai.com/v1/models 2>&1 | tail -3
echo "  返回体前 200 字节:"
head -c 200 /tmp/agnes-resp.txt 2>/dev/null | sed 's/^/    /' || echo "    (空)"

hdr "6. 结论速判"
echo "  - 全部域名 TCP 都失败 → 本机防火墙 / 局域网出口被拦"
echo "  - 仅 apihub.agnes-ai.com 失败 → Cloudflare 边缘节点被 GFW / QoS 干扰"
echo "  - DNS 拿到的 IP 与 Cloudflare 公开 IP 段不符 → DNS 污染"
echo "  - curl 拿到 HTTP 状态码 → 网络通了,问题在 key/限流"