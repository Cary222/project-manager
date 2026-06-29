// UI smoke test for the AI chat polish features. Uses Playwright to:
//   1. log in
//   2. open /ai
//   3. assert that on first visit a conversation gets auto-selected
//   4. add a tag to the first conversation via the API, reload, and assert
//      the tag chip shows up with a × button
//   5. click × and assert the tag disappears
//   6. open the user-profile panel, click "编辑", and verify the editable
//      form is rendered (input + 添加 button per field)
//
// Run with:
//   set -a && source .env.local && set +a && \
//   TEST_EMAIL=smoke@test.local TEST_PASSWORD=test123456 \
//   npx playwright test e2e/ai-chat-polish.spec.ts --reporter=list
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3003";
const EMAIL = process.env.TEST_EMAIL || "smoke@test.local";
const PASSWORD = process.env.TEST_PASSWORD || "test123456";

test.describe("AI chat page polish", () => {
  test("auto-selects most recent conversation + tags × + profile edit form", async ({ page }) => {
    // 1. Log in
    await page.goto(`${BASE}/login`);
    await page.fill('input[type="email"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ]);

    // 2. Pre-seed a tag on the most recent conversation so we can verify the
    //    tag chip + × button. Doing this via the API keeps the test simple.
    const seedRes = await page.request.get(`${BASE}/api/ai/conversations`);
    expect(seedRes.ok()).toBeTruthy();
    const seedJson = await seedRes.json();
    const conv = (seedJson.data ?? [])[0];
    if (!conv) test.skip(true, "no conversation to test against");
    const tag = `__ui_${Date.now()}`;
    await page.request.patch(`${BASE}/api/ai/conversations/${conv.id}`, {
      data: { tags: [...(conv.tags ?? []), tag] },
    });

    // Sanity-check the tag is persisted before we navigate.
    const verify = await page.request.get(`${BASE}/api/ai/conversations`);
    const vJson = await verify.json();
    const vConv = (vJson.data ?? []).find((c: { id: string }) => c.id === conv.id);
    if (!vConv?.tags?.includes(tag)) {
      throw new Error(`tag not persisted after PATCH: ${JSON.stringify(vConv)}`);
    }

    // 3. Open /ai (no ?c=) and assert auto-select happens
    await page.goto(`${BASE}/ai`);
    // URL should update to include ?c=...
    await page.waitForURL(/\?c=/, { timeout: 10000 });

    // Wait for the sidebar to actually render the conversation list (it loads
    // asynchronously after mount).
    await page.waitForLoadState("networkidle");

    // 4. Find the seeded tag chip in the sidebar
    const tagChip = page.getByText(tag, { exact: true }).first();
    await expect(tagChip).toBeVisible({ timeout: 5000 });

    // 5. Hover to reveal the × button and click it
    const removeBtn = page.getByRole("button", { name: `删除标签 ${tag}` });
    await removeBtn.click();
    await expect(tagChip).not.toBeVisible({ timeout: 5000 });

    // 6. Open the user profile panel and switch to edit mode
    //    First, seed a profile via the PATCH API so the panel renders
    //    something editable (otherwise it shows the "还没有画像" empty state).
    await page.request.patch(`${BASE}/api/ai/profile`, {
      data: {
        profile: {
          roles: ["测试角色"],
          interests: ["测试兴趣"],
          expertise: [],
          projects: [],
          recentTopics: [],
        },
      },
    });
    // Reload so the panel picks up the freshly created profile.
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The panel header has two buttons now: a "expand" button and an "edit" button.
    // Click the expand button (it has aria-label "展开画像") to ensure the body is open.
    const expandBtn = page.getByRole("button", { name: "展开画像" });
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
    }

    // Click the "编辑画像" icon button.
    const editBtn = page.getByRole("button", { name: "编辑画像" });
    await editBtn.click();

    // The "保存修改" button is the smoking gun: it only appears in edit mode.
    await expect(page.getByRole("button", { name: /保存修改/ })).toBeVisible();
    // Each editable field has an input with placeholder "添加<field>…".
    await expect(page.getByPlaceholder("添加角色…")).toBeVisible();

    // Cleanup: remove the seeded profile so the test is idempotent.
    await page.request.patch(`${BASE}/api/ai/profile`, {
      data: { profile: { roles: [], interests: [], expertise: [], projects: [], recentTopics: [] } },
    });
  });
});
