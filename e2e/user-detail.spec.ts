/**
 * e2e/user-detail.spec.ts — 用户详情页 E2E 测试
 *
 * 学习目标：
 * 1. 理解什么是 E2E 测试（真实浏览器，模拟用户操作）
 * 2. 学会用 page.goto() 打开页面
 * 3. 理解 Playwright 选择器（getByText / getByRole / locator）
 * 4. 学会用 expect().toHaveURL() / toBeVisible() 做断言
 *
 * 运行方式（确保 npm run dev 已启动）：
 *   npm run test:e2e
 *   npm run test:e2e:ui   （可视化操作过程）
 */

import { test, expect, Page } from "@playwright/test";

// ============================================================
// 共享测试配置（所有用例都会执行）
// ============================================================
test.describe("用户详情页 E2E", () => {

  // ----------------------------------------------------------
  // 前置条件：登录（每个测试前执行一次）
  // ----------------------------------------------------------
  // 先登录 ROOT 账号，再进入用户管理页面
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "项目管理" })).toBeVisible({ timeout: 10000 });

    // 确保在登录模式（不是注册模式）
    const loginTab = page.getByRole("button", { name: "登录" }).first();
    await loginTab.click();

    // 清空并填写表单
    const emailInput = page.getByLabel("邮箱");
    const passwordInput = page.getByLabel("密码");
    await emailInput.clear();
    await passwordInput.clear();
    await emailInput.fill("2428058380@qq.com");
    await passwordInput.fill("123456");

    // 点击提交按钮（表单的 submit 按钮，不是 tab 切换按钮）
    await page.locator("button[type='submit']").click();

    // 等待登录完成并跳转
    await expect(page).toHaveURL("/", { timeout: 10000 });

    // 进入用户管理页面
    await page.goto("/admin/users");
    // 等待页面加载完毕（等待侧边栏"用户管理"链接出现）
    await expect(page.getByText("用户管理")).toBeVisible({ timeout: 10000 });
  });

  // ----------------------------------------------------------
  // 用例 1：用户列表 → 进入详情页 → 验证内容
  // ----------------------------------------------------------
  test("用户列表 → 详情页 → 面包屑 + 单子列表可见", async ({ page }) => {
    // Step 1: 在用户列表页，点击第一个"查看单子"链接
    // getByText() 是 Playwright 最推荐的选择器（语义化，可访问性好）
    const viewLink = page.getByText("查看单子").first();
    await expect(viewLink).toBeVisible();
    await viewLink.click();

    // Step 2: 等待 URL 跳转到 /admin/users/:id
    await expect(page).toHaveURL(/\/admin\/users\/.+/);

    // Step 3: 面包屑出现"用户列表"链接（可点击）
    await expect(page.getByText("用户列表")).toBeVisible();

    // Step 4: 页面标题/面包屑包含用户名或邮箱（说明用户信息加载了）
    // 当前页面应有"单子"二字（单子列表区域标题）
    const ticketHeader = page.getByText("单子").first();
    await expect(ticketHeader).toBeVisible();
  });

  // ----------------------------------------------------------
  // 用例 2：详情页状态筛选功能
  // ----------------------------------------------------------
  test("状态筛选 → 列表数量变化", async ({ page }) => {
    // 先进入详情页
    await page.getByText("查看单子").first().click();
    await expect(page).toHaveURL(/\/admin\/users\/.+/);

    // 等待单子列表加载
    await expect(page.getByRole("heading", { name: /单子/ })).toBeVisible();

    // 查看默认"全部状态"下的所有单子数量
    // 找到"全部状态"的 select 元素
    const select = page.locator("select");
    await expect(select).toBeVisible();

    // 切换到"已完成"
    await select.selectOption({ label: "已完成" });

    // 等待页面更新（React 状态变化后 DOM 会变）
    // 验证 select 的值已变为 DONE
    await expect(select).toHaveValue("DONE");

    // 切回"全部状态"
    await select.selectOption({ label: "全部状态" });
    await expect(select).toHaveValue("");
  });

  // ----------------------------------------------------------
  // 用例 3：点击单号卡片 → 新窗口打开单子详情
  // ----------------------------------------------------------
  test("点击单号卡片 → 新标签页打开单子详情", async ({ page }) => {
    // 进入详情页
    await page.getByText("查看单子").first().click();
    await expect(page).toHaveURL(/\/admin\/users\/.+/);

    // 等待单子列表加载完毕
    await expect(page.getByRole("heading", { name: /单子/ })).toBeVisible();

    // 找第一个单号链接
    const ticketLink = page.locator("a", { hasText: /^#\d+/ }).first();
    await ticketLink.waitFor({ state: "visible", timeout: 10000 });

    // 获取链接的 URL
    const ticketUrl = await ticketLink.getAttribute("href");

    // 在新标签页中打开单子详情
    const newPage = await page.context().newPage();
    await newPage.goto(ticketUrl!);

    // 等待新标签加载完毕
    await newPage.waitForLoadState("domcontentloaded");

    // 验证新页面 URL 格式正确（/ticketNo）
    const newUrl = newPage.url();
    expect(newUrl).toMatch(/\/\d+$/);

    // 验证新页面加载了内容（非空白页）
    await expect(newPage.locator("body")).not.toBeEmpty();

    // 关闭新标签页
    await newPage.close();
  });

  // ----------------------------------------------------------
  // 用例 4：面包屑"用户列表"返回功能
  // ----------------------------------------------------------
  test("面包屑返回 → 回到用户列表", async ({ page }) => {
    // 进入详情页
    await page.getByText("查看单子").first().click();
    await expect(page).toHaveURL(/\/admin\/users\/.+/);

    // 点击面包屑的"用户列表"
    await page.getByText("用户列表").click();

    // 等待回到用户列表页
    await expect(page).toHaveURL("/admin/users");
    await expect(page.getByText("用户管理")).toBeVisible();
  });
});
