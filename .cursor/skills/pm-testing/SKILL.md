---
name: pm-testing
description: >-
  渐进式测试学习技能 for project-manager。从手动测试开始，逐步掌握 Vitest 单元测试和 Playwright E2E 测试。
  Use when user asks to test a feature, run tests, or wants to learn about testing.
disable-model-invocation: false
---

# project-manager 测试学习指南

## 学习路径

```
Stage 0（入门）→ Stage 1（手动测试）→ Stage 2（Vitest）→ Stage 3（Playwright）→ Stage 4（CI）
```

进度记录在 [progress.json](progress.json)，每次完成后更新 `learning` 字段。

---

## Stage 0 — 什么是测试（必读）

测试的本质：**写一段代码，验证另一段代码是否按预期工作。**

### 测试的三大目的

1. **防回归（Regression）**：改代码时，不知道哪里会坏，测试能第一时间告诉你
2. **文档化行为**：好的测试 = 活的文档，说明函数应该怎么用
3. **建立信心**：有测试覆盖的代码，改起来不怕，上线不心虚

### 测试金字塔

```
         /\
        /  \     E2E（真实浏览器，慢，少）
       /----\
      /      \   集成测试（组件配合，中等）
     /--------\
    /          \ 单元测试（最小函数，快，多）
   /____________\
```

**当前项目现状**：只有一个 `scripts/acceptance-test.ts`（手动跑 node 脚本测 commit 解析），没有标准测试框架。本技能将从零搭建测试基础设施。

---

## E2E 测试数据保护准则（必须遵守）

**核心原则：测试必须创建自己的测试数据，绝不能修改或删除现有数据。**

### 准则内容

1. **创建测试数据优先**
   - 删除测试：先创建一个临时测试模块/单子，测试完成后删除该测试数据
   - 编辑测试：创建临时测试数据，测试完成后清理
   - 如果现有数据适合测试，也要先备份或记录原始状态

2. **测试数据结构**
   ```typescript
   test("删除模块 → 确认后模块消失", async ({ page }) => {
     // 1. 创建测试数据（通过UI或API）
     const testModuleName = `测试模块_${Date.now()}`;
     await createTestModule(page, testModuleName);
     
     // 2. 执行测试操作
     await deleteModule(page, testModuleName);
     
     // 3. 验证结果
     await expect(...).toBeVisible();
     
     // 4. 清理（如果需要）
   });
   ```

3. **禁止的操作**
   - ❌ 直接删除现有模块/单子进行测试
   - ❌ 修改现有数据的名称或描述进行测试
   - ❌ 在测试中硬编码现有数据的ID

4. **例外情况**
   - 如果测试是"回归测试"（验证修复不会破坏现有功能），可以使用现有数据但不能修改
   - 如果必须使用现有数据，先确认用户已备份

---

## Stage 1 — 手动测试（每个功能的起点）

### 什么时候开始

当你完成一个新功能后，**先不要急着写自动化测试**，先用手动测试确认功能正常。

### 手动测试检查清单模板

```markdown
## [功能名] 手动测试清单

### 前置条件
- [ ] 已登录为 ROOT 用户
- [ ] 服务运行在 http://localhost:3003

### 正常路径
- [ ] 步骤1：...
- [ ] 步骤2：...

### 边界情况
- [ ] 情况A：...
- [ ] 情况B：...

### 完成后
- [ ] 所有检查项已通过
```

### 流程

1. 根据当前功能，生成具体检查清单给用户
2. 用户照清单逐项操作，记录结果
3. 用户通过后，更新 progress.json：`"stage1_manual": true`
4. 然后进入 Stage 2（自动化测试）

---

## Stage 2 — Vitest 单元测试

### 安装依赖

运行以下命令：

```bash
npm install -D vitest @testing-library/react jsdom @types/node
```

### 创建 vitest.config.ts

```typescript
// vitest.config.ts（项目根目录）
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

### 添加 package.json 脚本

在 `scripts` 中添加：

```json
"test": "vitest run",
"test:watch": "vitest"
```

### 写第一个测试文件

针对 [actions/admin.ts](actions/admin.ts) 中的函数创建 [actions/admin.test.ts](actions/admin.test.ts)，参考 [reference.md](reference.md) 中的 AAA 模式和 Mock 知识。

测试结构：

```typescript
// 每个 describe 块测一个函数
describe("getUserByIdAction", () => {
  // 每个 it 块测一个场景
  it("存在的用户返回用户对象", async () => {
    // Arrange：准备数据（通常通过 mock）
    // Act：调用函数
    // Assert：验证结果
  });

  it("不存在的用户返回 null", async () => {
    // ...
  });
});
```

### Mock 权限函数（必须）

action 函数调用 `requireRoot()` 会读取 session。测试时需要伪造它：

```typescript
vi.mock("@/lib/permissions", () => ({
  requireRoot: vi.fn(),
}));
```

### 运行测试

```bash
npm run test
```

绿灯 = 所有用例通过。红灯 = 有用例失败，看错误信息定位问题。

### 完成后

更新 `progress.json`：`"stage2_vitest": true`

---

## Stage 3 — Playwright E2E 测试

### 安装依赖

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### 创建 playwright.config.ts

```typescript
// playwright.config.ts（项目根目录）
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3003",
    headless: true,
  },
});
```

### 添加 package.json 脚本

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

### 写第一个 E2E 测试

创建 [e2e/user-detail.spec.ts](e2e/user-detail.spec.ts)，针对用户详情页写 3 个用例：

```typescript
// e2e/user-detail.spec.ts
import { test, expect } from "@playwright/test";

// test 接收两个参数：测试名称 + 测试函数
test("用户列表 → 详情页 → 显示用户信息", async ({ page }) => {
  // 1. 打开用户列表
  await page.goto("/admin/users");

  // 2. 点击任意用户的"查看单子"链接
  await page.getByText("查看单子").first().click();

  // 3. 验证 URL 包含 /admin/users/
  await expect(page).toHaveURL(/\/admin\/users\/.+/);

  // 4. 验证面包屑出现"用户列表"
  await expect(page.getByText("用户列表")).toBeVisible();

  // 5. 验证有单子列表或"暂无单子"文字
  const ticketSection = page.getByText("单子").first();
  await expect(ticketSection).toBeVisible();
});
```

### 运行测试

```bash
# 确保服务已启动（npm run dev）
# 终端 1: npm run dev
# 终端 2: npm run test:e2e

# 或用 UI 模式（可视化操作过程）
npm run test:e2e:ui
```

### 完成后

更新 `progress.json`：`"stage3_playwright": true`

---

## Stage 4 — CI 集成（可选，学完前三步后）

push 代码时自动跑测试，不需要手动触发。

创建 `.github/workflows/test.yml`：

```yaml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run test
      - run: npm run build
```

---

## 每个功能的标准测试流程（总结）

```
新功能完成
    ↓
Stage 1: 手动测试清单（边测边讲知识）
    ↓ 通过后
Stage 2: Vitest 单元测试（action 函数）
    ↓ 通过后
Stage 3: Playwright E2E 测试（完整页面流程）
    ↓ 通过后
功能完成 → 记录到 progress.json.completed_features
```

---

## 参考

- 详细知识：[reference.md](reference.md)
- 进度记录：[progress.json](progress.json)
- 项目架构：[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
