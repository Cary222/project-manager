import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("邮箱").fill("2428058380@qq.com");
  await page.getByLabel("密码").fill("123456");
  await page.locator("button[type='submit']").click();
  await page.waitForURL("/", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
}

test.describe("侧边栏折叠/展开", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // 清空 sidebar 相关 localStorage，确保干净初始状态
    await page.evaluate(() => {
      localStorage.removeItem("app-sidebar-collapsed");
      localStorage.removeItem("app-sidebar-collapsed-interacted");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");
  });

  test("场景1：首次折叠→切换tab→展开", async ({ page }) => {
    const aside = page.locator("aside").first();

    // 初始：展开
    const w0 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[1] 初始宽度:", w0);
    expect(w0).toBeGreaterThan(200);

    // 点击折叠
    await page.getByRole("button", { name: "收缩侧边栏" }).click();
    await page.waitForTimeout(400);
    const w1 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[1] 折叠后宽度:", w1);
    expect(w1).toBeLessThan(100);

    // 记录折叠后的 class
    const classAfterCollapse = await aside.getAttribute("class");
    console.log("[1] 折叠后 class:", classAfterCollapse);
    expect(classAfterCollapse).toContain("transition-all");

    // 切换 tab：导航到项目页
    await page.click("a[href='/projects']");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);

    const w2 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[1] 切换tab后宽度:", w2);
    expect(w2).toBeLessThan(100);

    // 展开
    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await page.waitForTimeout(400);
    const w3 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[1] 展开后宽度:", w3);
    expect(w3).toBeGreaterThan(200);
  });

  test("场景2：折叠→刷新→保持折叠→展开", async ({ page }) => {
    const aside = page.locator("aside").first();

    await page.getByRole("button", { name: "收缩侧边栏" }).click();
    await page.waitForTimeout(400);
    const w1 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    expect(w1).toBeLessThan(100);

    // 刷新
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const w2 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[2] 刷新后宽度:", w2);
    expect(w2).toBeLessThan(100);

    // 展开
    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await page.waitForTimeout(400);
    const w3 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    expect(w3).toBeGreaterThan(200);
  });

  test("场景3：展开→刷新→保持展开", async ({ page }) => {
    const aside = page.locator("aside").first();

    // 折叠再展开（建立 interacted 状态）
    await page.getByRole("button", { name: "收缩侧边栏" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await page.waitForTimeout(300);
    const w1 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    expect(w1).toBeGreaterThan(200);

    // 刷新，应该保持展开
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(400);
    const w2 = await aside.evaluate((el) => el.getBoundingClientRect().width);
    console.log("[3] 刷新后宽度:", w2);
    expect(w2).toBeGreaterThan(200);
  });
});
