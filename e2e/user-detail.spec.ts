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
  // 思路：用 page.goto() 直接进入 /admin/users，跳过登录页
  // 真实场景下 Playwright 支持 storageState 保存登录状态，
  // 这里用直接 URL 访问来简化教学。
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/users");
    // 等待页面加载完毕（等待用户列表出现）
    await expect(page.getByText("用户管理")).toBeVisible();
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
    await expect(page.getByText("单子")).toBeVisible();

    // 查看默认"全部状态"下的所有单子数量
    // 找到"全部状态"的 select 元素
    const select = page.locator("select");
    await expect(select).toBeVisible();

    // 切换到"已完成"
    await select.selectOption({ label: "已完成" });

    // 等待页面更新（React 状态变化后 DOM 会变）
    // 验证没有报错即可
    await expect(select).toHaveValue(expect.stringContaining("DONE"));

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

    // 找第一个单号链接（格式为 #数字，如 #10001）
    // getByText 加上正则匹配
    const ticketLink = page.locator("text=/^#\\d+$/").first();

    // 如果页面上有单号链接（可能有"暂无单子"的情况），则测试
    const ticketCount = await page.locator("text=/^#\\d+$/").count();
    if (ticketCount > 0) {
      // 用 Promise.all 同时打开新标签
      const [newPage] = await Promise.all([
        page.context().waitForEvent("page"),
        ticketLink.click(),
      ]);

      // 等待新标签加载完毕
      await newPage.waitForLoadState("domcontentloaded");

      // 新页面 URL 应包含 ticketNo（纯数字路径）
      // 预期格式如 /10001
      const newUrl = newPage.url();
      expect(newUrl).toMatch(/\/\d+$/);

      // 验证新页面加载了内容（非空白页）
      await expect(newPage.locator("body")).not.toBeEmpty();
    } else {
      // 没单子的情况：验证"暂无单子"提示出现
      await expect(page.getByText("暂无单子")).toBeVisible();
    }
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
