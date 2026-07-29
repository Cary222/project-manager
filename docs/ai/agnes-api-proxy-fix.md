# Agnes API 代理转发修复 — 开发复现手册

> 适用：project-manager 仓库（Next.js + Prisma + AI SDK）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能完整复现本次修复过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

`@ai-sdk/openai` 调用 Agnes API 时，遇到两类错误：

**错误 1（initiator）：**
```
agent.dispatch is not a function
```
`https-proxy-agent` v7 底层用的是 Node.js 原生 `http.Agent`，实现了 `http.Agent` 接口但没有 `dispatch` 方法。AI SDK 7.x 内部把代理对象当成 undici 的 `Dispatcher` 调用 `dispatch()`，于是报错。

**错误 2（DNS 污染）：**
```
Connect Timeout Error (attempted addresses: 69.63.187.12:443 ...)
```
`69.63.187.12` 是 Meta/Facebook IP 段。系统 DNS（ISP 提供）把 `apihub.agnes-ai.com` 错误解析到这个地址，导致 TCP 连接超时。

**错误 3（修复代理转发后）：**
```
response.headers is not iterable
```
undici 的 `response.headers` 是普通 `{ [key]: string | string[] }` 对象，而标准 `Response.headers` 是可迭代的 `Headers` 对象。直接传给 `new Response()` 导致报错。

### 1.2 结论

用 undici 内置的 `ProxyAgent`（自身就是 `Dispatcher`）替换 `https-proxy-agent`，同时将 undici 响应标准化为 Web API `Response`，解决了全部三个错误。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/lib/agnes-provider.ts` | 修改 | 用 undici `ProxyAgent` 替换 `https-proxy-agent`，自定义 `fetch` 处理代理转发和响应标准化 |

---

## 3. 核心实现

### 3.1 代理转发（`features/ai/lib/agnes-provider.ts`）

核心思路：不通过 `fetchOptions.dispatcher` 传 `ProxyAgent`（那样仍然走 Node.js 内置 fetch），而是通过 `fetch` 参数注入一个**自定义 fetch 函数**，内部用 undici 的 `request()` + `ProxyAgent`。

```14:51:features/ai/lib/agnes-provider.ts
function buildProxyFetch() {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  const proxyAgent = new ProxyAgent({ uri: proxyUrl });

  return async function proxyFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const urlStr = ...;
    const { request } = await import("undici");
    const response = await request(urlStr, {
      ...init,
      dispatcher: proxyAgent,
    } as Parameters<typeof request>[1]);

    // Normalize undici response headers → standard Headers
    const normalizedHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") {
        normalizedHeaders.append(key, value);
      } else if (Array.isArray(value)) {
        for (const v of value) normalizedHeaders.append(key, v);
      }
    }

    return new Response(response.body as unknown as BodyInit, {
      status: response.statusCode,
      headers: normalizedHeaders,
    });
  };
}
```

### 3.2 Provider 创建（`features/ai/lib/agnes-provider.ts`）

```53:58:features/ai/lib/agnes-provider.ts
export const agnes = createOpenAI({
  baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  fetch: buildProxyFetch(),
});
```

**为什么这样写：**
- `fetch` 参数优先级高于 `fetchOptions.dispatcher`，确保所有请求都走自定义逻辑
- `ProxyAgent` 是 undici 的内置类型，`dispatcher` 属性直接可赋值，不用额外交互
- HTTP 代理走 CONNECT 隧道，DNS 解析由代理服务器完成，无需额外国产 DNS 配置

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|----|------|
| `AGNES_API_URL` | `https://apihub.agnes-ai.com/v1` | Agnes API 端点 |
| `OPENAI_API_KEY` | `sk-yQjnW...` | API 密钥 |
| `HTTPS_PROXY` / `HTTP_PROXY` | `http://127.0.0.1:7890` | 代理地址 |
| 依赖 | `@ai-sdk/openai@4.0.5` + `ai@7.0.11` + `undici@7.27.0` | 必须同时满足 |

---

## 5. 启动 / 部署

```bash
# 1. 重启 dev server（修改代码后必须重启）
cd /Users/vastgui/Desktop/project-manager
kill $(lsof -ti:3003) 2>/dev/null; sleep 1
npm run dev > /dev/null 2>&1 &
sleep 5

# 2. 确认服务存活
curl -s http://localhost:3003/api/ai/geo
```

---

## 6. 测试 & 验证

### 6.1 手动测试

在浏览器打开 `http://localhost:3003`，进入 AI 对话面板，发送一条会触发 Agnes API 的消息（如询问周报、生成报告等）。

**期望**：AI 正常返回结果，终端无 `agent.dispatch is not a function`、`response.headers is not iterable`、DNS 超时等错误。

### 6.2 终端日志验证

```bash
# 观察终端，搜索关键字
# 无以下错误即为成功：
grep -E "dispatch is not a function|headers is not iterable|Connect Timeout" \
  /Users/vastgui/.cursor/projects/Users-vastgui-Desktop-project-manager/terminals/1.txt
# 期望：无输出
```

### 6.3 代码层验证（可选）

```bash
# 直接测试 ProxyAgent + Agnes API 连通性
node -e "
import('undici').then(async ({ request, ProxyAgent }) => {
  const r = await request('https://apihub.agnes-ai.com/v1/models', {
    dispatcher: new ProxyAgent({ uri: 'http://127.0.0.1:7890' }),
    headers: { 'Authorization': 'Bearer test' },
  });
  console.log('status:', r.statusCode, '(期望非 0，非连接超时)');
}).catch(e => console.log('连接失败:', e.message));
"
# 期望输出：status: 401（到达服务器，密钥错误 = 成功）
```

---

## 7. 复现 Checklist

- [ ] 确认 `HTTPS_PROXY` / `HTTP_PROXY` 在 `.env.local` 中已配置
- [ ] 确认 `AGNES_API_URL` 和 `OPENAI_API_KEY` 已配置
- [ ] 确认代码中 `fetch: buildProxyFetch()` 已传入 `createOpenAI()`
- [ ] 重启 dev server
- [ ] 浏览器发送 AI 消息，观察终端无报错
- [ ] 确认 AI 返回了正常结果（非超时 / 非连接错误）

---

## 8. 踩坑记录

### 坑 1：`agent.dispatch is not a function`

**现象**：AI SDK 调用时报错 `Cannot connect to API: agent.dispatch is not a function`

**原因**：`https-proxy-agent` v7 底层是 Node.js 原生 `http.Agent`，只实现了 `http.Agent` 接口。AI SDK 7.x 内部用 `dispatcher.dispatch()` 调用代理对象，而原生 Agent 没有 `dispatch` 方法。

**解法**：弃用 `https-proxy-agent`，改用 undici 内置的 `ProxyAgent`。undici `ProxyAgent` 实现了完整的 `Dispatcher` 接口，`dispatch` 方法可用。

### 坑 2：DNS 污染导致连接超时

**现象**：`Connect Timeout Error (attempted addresses: 69.63.187.12:443 ...)` —— `69.63.187.12` 是 Meta IP 段

**原因**：系统 DNS（ISP）把 `apihub.agnes-ai.com` 错误解析到 Facebook IP。后续调试发现 HTTP 代理走 CONNECT 隧道后 DNS 解析由代理服务器完成，实测无需额外国产 DNS 配置。

**解法**：先尝试过在 `ProxyAgent` 上配置 `dns: { resolvers: ['8.8.8.8'] }`（undici 不支持），后确认 HTTP 代理 CONNECT 隧道不需要本地 DNS，直接移除 `connect` 选项，简化了实现。

### 坑 3：`response.headers is not iterable`

**现象**：修复代理转发后，`new Response(response.body, { headers: response.headers })` 报错 `response.headers is not iterable`

**原因**：undici 的 `response.headers` 是普通 `{ [key]: string | string[] }` 对象，而标准 Web API `Response.headers` 要求是 `Headers`（可迭代）。类型不兼容。

**解法**：手动遍历 undici headers 对象，构建标准 `Headers` 实例，再传给 `new Response()`。

### 坑 4：TS 类型错误 — `BodyReadable` 不能赋给 `BodyInit`

**现象**：`Argument of type 'BodyReadable & BodyMixin' is not assignable to parameter of type 'BodyInit'`

**原因**：undici 的 `response.body` 类型是 `BodyReadable & BodyMixin`，与 `BodyInit`（`Blob | ArrayBuffer | TypedArray | DataView | ReadableStream | URLSearchParams | FormData | null`）没有类型兼容关系。但运行时 Node.js `Response` 构造器实际接受这个类型。

**解法**：加 `as unknown as BodyInit` 类型断言绕过 TS 检查，运行时不受影响。
