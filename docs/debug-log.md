# 图片上传 Bug 修复日志

> 适用：project-manager 仓库（Next.js 16 + Prisma）
> 目标：记录图片上传失败的问题定位与修复过程

---

## 1. 问题背景

### 1.1 现象
- 用户通过 `http://192.168.1.14:3003` IP 地址访问项目
- 在新建单子页面点击上传图片时，浏览器报错：
  ```
  Cannot read properties of undefined (reading 'digest')
  ```
- 页面崩溃，显示 `GlobalError` 组件

### 1.2 根因
- `crypto.subtle` API 只能在**安全上下文**中使用（`https://` 或 `http://localhost`）
- 生产环境 `NEXTAUTH_URL=http://192.168.1.14:3003` 使用普通 HTTP
- 浏览器禁用了 `crypto.subtle`，导致 `crypto.subtle` 为 `undefined`
- 调用 `.digest()` 时报错

### 1.3 结论
- `shared/lib/hash.ts`：添加 `crypto?.subtle` 检查，不可用意况返回 `null`
- `shared/lib/upload.ts`：只有 `clientHash` 有值时才上传 hint
- 服务端代码无需修改（本来就不依赖客户端 hint）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/lib/hash.ts` | 修改 | 浏览器端文件 hash 计算，添加安全上下文检查 |
| `shared/lib/upload.ts` | 修改 | 客户端上传逻辑，条件上传 clientHash |

---

## 3. 核心实现

### 3.1 `shared/lib/hash.ts`

```21:33:shared/lib/hash.ts
export async function sha256File(file: File): Promise<string | null> {
  let subtle;
  try {
    subtle = crypto?.subtle;
  } catch {
    return null;
  }
  if (!subtle) {
    return null;
  }
  const buffer = await file.arrayBuffer();
  const hashBuffer = await subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

**设计意图**：
- `crypto.subtle` 只在安全上下文可用，非安全上下文返回 `null`
- `try-catch` 防止访问 `crypto?.subtle` 本身抛错

### 3.2 `shared/lib/upload.ts`

```64:71:shared/lib/upload.ts
  const clientHash = await sha256File(file);

  const form = new FormData();
  form.append("file", file, file.name);
  if (clientHash) {
    form.append("clientHash", clientHash);
  }
```

**设计意图**：
- `clientHash` 为 `null` 时跳过 hint，上传给服务端的 form 只有 `file` 字段
- 服务端完全独立计算 hash，不依赖客户端 hint

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|----|------|
| `NEXTAUTH_URL` | `http://192.168.1.14:3003` | 普通 HTTP，非安全上下文 |
| `AUTH_TRUST_HOST` | `true` | NextAuth 信任代理 |
| 上传端口 | 3003 | 主应用端口 |

---

## 5. 启动 / 部署

```bash
# 1. SSH 到服务器
ssh hxy@192.168.1.14

# 2. 进入项目目录
cd /home/hxy/work/personal/project-manager

# 3. 拉取最新代码
git pull

# 4. 重新构建
npm run build

# 5. 重启服务
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start
```

---

## 6. 测试 & 验证

### 6.1 本地验证

```bash
# 确认本地服务启动
curl http://localhost:3003/
# 期望：返回 HTML 页面
```

### 6.2 端到端验证

1. 浏览器访问 `http://192.168.1.14:3003`
2. 登录后进入任意项目
3. 点击新建单子
4. 上传一张图片（PNG/JPG，最大 10MB）
5. **期望**：图片正常显示，无报错

---

## 7. 复现 Checklist

- [ ] 确认 `NEXTAUTH_URL` 为 HTTP 地址（非 HTTPS）
- [ ] 通过 IP 地址（非 localhost）访问站点
- [ ] 尝试上传图片
- [ ] 确认不再报 `digest` 错误
- [ ] 确认图片正常显示在编辑器中

---

## 8. 踩坑记录

### 坑 1：首次修复不完整

**现象**：
```js
if (!crypto?.subtle) {
  return null;
}
```
部分用户仍遇到报错。

**原因**：
访问 `crypto?.subtle` 本身在某些环境下可能抛错（非严格等于 undefined）。

**解法**：
```js
let subtle;
try {
  subtle = crypto?.subtle;
} catch {
  return null;
}
if (!subtle) {
  return null;
}
```

### 坑 2：TypeScript 类型不兼容

**现象**：
`uploadFile` 返回类型 `UploadedFileResult` 声明 `hash: string`，但 `clientHash` 变成 `string | null`。

**原因**：
```ts
hash: body.hash ?? clientHash  // clientHash 可能是 null
```

**解法**：
```ts
hash: body.hash ?? clientHash ?? ""
```

### 坑 3：图片 URL 处理冗余

**现象**：
多处代码手动拼接 `window.location.origin + url`。

**原因**：
`uploadFile` 返回的 `url` 已经是相对路径，服务端 `/api/upload/[id]` 路由会自动处理。

**解法**：
直接使用返回的 `url`，移除手动的 origin 拼接。

---

## 9. 相关提交

| Commit | 描述 |
|--------|------|
| `586731c` | 首次修复：`crypto.subtle` 检查 |
| `d0a647e` | 增强：添加 try-catch |
| `19a4af3` | 类型修复：`hash ?? clientHash ?? ""` |
| `6e12ebd` | 简化：移除冗余的 URL 拼接 |
