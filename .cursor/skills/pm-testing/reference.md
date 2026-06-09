# 测试知识参考

按需查阅，每个小节独立，可跳读。

---

## 1. 测试金字塔

```
        /\
       /  \      E2E（少量，慢，真实浏览器）
      /----\
     /      \    集成测试（中等，中等）
    /--------\
   /          \  单元测试（大量，快，隔离）
  /____________\
```

- **单元测试**：测一个最小函数，输入 → 输出，不碰真实数据库
- **集成测试**：测多个组件配合，比如一个 action + 数据库
- **E2E（端到端）**：开真实浏览器，模拟用户操作，从头测到尾

---

## 2. AAA 模式（单元测试结构）

每个单元测试分三步：

```typescript
// Arrange：准备数据
const input = { ticketNo: 10001 };

// Act：执行你要测的函数
const result = await getTicketByNo(input);

// Assert：验证结果是否符合预期
expect(result?.ticketNo).toBe(10001);
```

---

## 3. Mock 是什么

mock = 伪造。单元测试要求"隔离"，但 action 函数会调用 `requireRoot()`（读 session）、访问数据库。

所以我们把依赖"伪造"掉，让它们返回我们预设的值：

```typescript
// 伪造 requireRoot，不让它真的检查权限
vi.mock("@/lib/permissions", () => ({
  requireRoot: vi.fn(),   // 默认不做任何事，直接通过
}));
```

这样测试只关注 action 本身的逻辑，不被权限/数据库干扰。

| 概念 | 说明 |
|------|------|
| `vi.fn()` | 创建一个空函数，可以监视它是否被调用 |
| `vi.mock()` | 伪造整个模块（所有 export） |
| `vi.mocked()` | 告诉 TypeScript 这个东西是 mock 的 |
| `beforeEach()` | 每个测试用例运行前执行，常用于重置 mock |

---

## 4. Vitest 常用 API

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// describe 把多个相关测试归为一组
describe("getUserByIdAction", () => {
  // it 是单个测试用例，第二个参数是测试函数
  it("返回存在的用户", async () => {
    const user = await getUserByIdAction("user-123");
    expect(user).not.toBeNull();         // 不为 null
    expect(user?.name).toBe("张三");      // 字段值匹配
  });

  it("不存在的用户返回 null", async () => {
    const user = await getUserByIdAction("not-exist");
    expect(user).toBeNull();             // 严格等于 null
  });
});
```

### 常用断言

| 断言 | 含义 |
|------|------|
| `expect(x).toBe(y)` | 严格相等（===），适合原始值 |
| `expect(x).toEqual(y)` | 深度相等，适合对象/数组 |
| `expect(x).toBeNull()` | x === null |
| `expect(x).toBeUndefined()` | x === undefined |
| `expect(x).toContain(y)` | 数组/字符串包含 y |
| `expect(x).toHaveLength(n)` | 数组长度为 n |
| `expect(() => fn()).toThrow()` | 函数抛出异常 |

---

## 5. Playwright 常用 API

```typescript
import { test, expect } from "@playwright/test";

test("进入用户详情页", async ({ page }) => {
  // 打开页面
  await page.goto("http://localhost:3003/admin/users");

  // 找元素并点击（link text）
  await page.getByText("查看单子").first().click();

  // 等待 URL 变化
  await expect(page).toHaveURL(/\/admin\/users\/.+/);

  // 验证页面内容
  await expect(page.getByRole("heading", { name: /张三|email/ })).toBeVisible();
});
```

### 选择器优先级（从好到差）

1. `page.getByRole()` — 语义化，最推荐
2. `page.getByLabel()` — 表单标签
3. `page.getByText()` — 文本内容
4. `page.getByTestId()` — data-testid 属性
5. CSS 选择器（`page.locator(".class")`）— 脆弱，慎用

### 常用操作

| 操作 | 含义 |
|------|------|
| `page.goto(url)` | 打开页面 |
| `page.click(selector)` | 点击 |
| `page.fill(selector, text)` | 输入文字 |
| `page.selectOption(selector, value)` | 下拉选择 |
| `page.locator(selector).count()` | 计数 |
| `expect(locator).toBeVisible()` | 元素可见 |
| `expect(locator).toHaveText(text)` | 文本匹配 |
| `expect(page).toHaveURL(/regex/)` | URL 匹配 |

---

## 6. Playwright 调试技巧

```bash
# 打开 Playwright Inspector（可视化调试）
npx playwright test --ui

# 在失败的测试上截取截图（自动保存到 test-results/）
npx playwright test --screenshot=on

# 运行时录制操作，生成代码
npx playwright codegen http://localhost:3003

# 只运行某个文件
npx playwright test e2e/user-detail.spec.ts

# 停止在第一个错误
npx playwright test --debug
```

---

## 7. Vitest 调试技巧

```bash
# 监听模式（文件变化自动重跑）
npx vitest

# 只运行一个文件
npx vitest actions/admin.test.ts

# 覆盖 jsdom 环境（支持 DOM API）
npx vitest --environment jsdom

# 详细输出
npx vitest run --reporter=verbose
```

---

## 8. 什么时候该写什么测试

| 场景 | 推荐测试类型 |
|------|------------|
| 改了一个 action 函数的逻辑 | 单元测试（vitest） |
| 改了页面组件渲染逻辑 | 单元测试（vitest + rtl） |
| 改了路由/页面跳转流程 | E2E 测试（playwright） |
| 改了数据库查询 | 集成测试（vitest + 真实数据库） |
| 提交 PR 之前 | 全量跑一遍 vitest + playwright |
