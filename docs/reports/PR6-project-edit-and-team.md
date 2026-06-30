# 项目详情页编辑与团队联动 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js + Prisma + PostgreSQL）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"项目详情页编辑与团队联动"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **概览 Tab 无法编辑**：项目名称、描述、状态、负责人只能在创建时填写，概览页只读，无法修改。
- **成员管理缺失**：无法在项目详情页内添加/移除成员、切换角色，只能通过创建项目时预设。
- **团队页面单一视角**：`/team` 页面只有「按项目」视角，无法看到公司全站所有成员及其参与的所有项目。

### 1.2 结论

- 概览 Tab 支持 ROOT/项目 OWNER 内联编辑（项目名/描述/状态/负责人），带保存/取消。
- 成员 Tab 支持 ROOT/项目 OWNER 添加、移除、切换成员角色（含最后一名 OWNER 保护）。
- `/team` 页面新增「按项目 / 全部成员」分段切换；`/team/[id]` 保持单视角不变。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/lib/permissions.ts` | 修改 | 新增 `requireProjectEditor(projectId)`，ROOT 直接放行；其他用户查 `UserOnProject` 表确认成员身份 |
| `app/api/projects/[id]/route.ts` | 修改 | PATCH 权限从 `requireRoot` 改为 `requireProjectEditor`；`ownerId` 变更走事务同步 `UserOnProject.role` |
| `app/api/projects/[id]/members/route.ts` | 新增 | GET（项目成员+候选人池）/ POST（添加成员）/ DELETE（移除成员） |
| `app/api/projects/[id]/members/[userId]/route.ts` | 新增 | PATCH（切换成员角色 OWNER ↔ MEMBER，含最后 OWNER 保护） |
| `app/api/team/members/route.ts` | 新增 | GET 返回全站成员（含每人参与项目列表），供「全部成员」视图用 |
| `features/project/ui/ProjectDetail.tsx` | 修改 | `OverviewTab` 改为受控编辑组件；去掉内联 `MemberTab` 替换为 `ProjectMemberTab` |
| `features/project/ui/ProjectMemberTab.tsx` | 新增 | 成员管理 UI：添加弹窗（多选+角色）/ inline 角色切换 / 移除（含二次确认） |
| `features/profile/lib/profile-actions.ts` | 修改 | 新增 `TeamMemberWithProjects` 类型和 `getAllTeamMembersAction()` |
| `app/team/page.tsx` | 修改 | 新增 URL `?view=projects|all` 分段切换器；`view=all` 时渲染 `ProfileAllMembers` |
| `features/team/ui/ProfileAllMembers.tsx` | 新增 | 全部成员视图：每人一张卡，卡内列出参与项目链接 |

---

## 3. 核心实现

### 3.1 权限体系（`shared/lib/permissions.ts`）

```15:28:shared/lib/permissions.ts
export async function requireProjectEditor(projectId: string) {
  const session = await requireSession();
  if (session.user.role === UserRole.ROOT) return session;

  const membership = await prisma.userOnProject.findUnique({
    where: { userId_projectId: { userId: session.user.id, projectId } },
  });
  if (membership) return session;

  throw new Error("FORBIDDEN");
}
```

**为什么这样写**：ROOT 不受限制直接放行；其他用户必须通过 `UserOnProject` 表确认是项目成员（OWNER 或 MEMBER 均可），保持最小权限原则。

### 3.2 ownerId 变更事务（`app/api/projects/[id]/route.ts`）

```39:72:app/api/projects/[id]/route.ts
if (data.ownerId !== undefined && data.ownerId !== project.ownerId) {
  const newOwnerId = data.ownerId;

  if (newOwnerId !== null) {
    const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!newOwner) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (oldOwnerId && oldOwnerId !== newOwnerId) {
      const oldOwnerMembership = await tx.userOnProject.findUnique({
        where: { userId_projectId: { userId: oldOwnerId, projectId: id } },
      });
      if (oldOwnerMembership && oldOwnerMembership.role === "OWNER") {
        await tx.userOnProject.update({
          where: { userId_projectId: { userId: oldOwnerId, projectId: id } },
          data: { role: "MEMBER" },
        });
      }
    }

    if (newOwnerId) {
      await tx.userOnProject.upsert({
        where: { userId_projectId: { userId: newOwnerId, projectId: id } },
        create: { userId: newOwnerId, projectId: id, role: "OWNER" },
        update: { role: "OWNER" },
      });
    }

    await tx.project.update({
      where: { id },
      data: { ownerId: newOwnerId },
    });
  });
}
```

**为什么这样写**：必须用事务确保 `Project.ownerId` 字段与 `UserOnProject.role` 状态一致；旧负责人降级、新负责人 upsert（可能在或不在成员表），最后才更新 `Project`。

### 3.3 最后一名 OWNER 保护（`app/api/projects/[id]/members/route.ts`）

```75:84:app/api/projects/[id]/members/route.ts
if (membership.role === "OWNER") {
  const ownerCount = await prisma.userOnProject.count({
    where: { projectId: id, role: "OWNER" },
  });
  if (ownerCount <= 1) {
    return NextResponse.json({ error: "LAST_OWNER" }, { status: 409 });
  }
}
```

**为什么这样写**：DELETE 和 PATCH 降级时都要校验，禁止把项目带入"无 OWNER"状态。前端弹窗也做二次确认但仅为人机保障，后端是真正安全边界。

### 3.4 项目详情页编辑态（`features/project/ui/ProjectDetail.tsx`）

```269:282:features/project/ui/ProjectDetail.tsx
function OverviewTab({
  project,
  editing,
  onEdit,
  onCancel,
  onSaved,
  canEdit,
}: {
  project: ProjectWithStatus;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  canEdit: boolean;
}) {
```

```688:693:features/project/ui/ProjectDetail.tsx
  const currentUserId = session?.user?.id ?? "";
  const userIsRoot = isRoot(session?.user?.role);
  const isOwner = project.members?.some(
    (m) => m.user.id === currentUserId && m.role === "OWNER"
  ) ?? false;
  const canEditProject = userIsRoot || isOwner;
```

**为什么这样写**：权限在父组件通过 `useSession` + `project.members` 计算，通过 props 传递给 `OverviewTab` 和 `ProjectMemberTab`，避免各子组件重复查 session。

### 3.5 团队页面分段切换（`app/team/page.tsx`）

```9:11:app/team/page.tsx
  const { view } = await searchParams;
  const currentView = view === "all" ? "all" : "projects";
```

**为什么这样写**：使用 URL search param 而非 local state，保证切换后页面可分享、刷新状态不丢失，与项目详情页的 tab query 风格一致。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 数据库 | PostgreSQL | Prisma 管理的 pm schema |
| Node.js | >= 18 | Next.js 15 要求 |
| 端口 | 3003 | 项目运行端口 |
| 环境变量 | `.env.local` 中的 `DATABASE_URL` | PostgreSQL 连接字符串 |
| 新增依赖 | 无 | 未引入任何新 npm 包 |

---

## 5. 启动 / 部署

```bash
# 1. 确认服务运行
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 2. 确认数据库连接正常（访问任意需要 auth 的页面）
# 浏览器打开 http://localhost:3003/login

# 3. TypeScript 类型检查（开发验证用）
npx tsc --noEmit
```

---

## 6. 测试 & 验证

### 6.1 概览 Tab 编辑

```bash
# 以 ROOT 或项目 OWNER 登录
# 打开 http://localhost:3003/projects/<project-id>
# 点击「编辑项目」按钮
# 修改名称/描述/状态/负责人，点击「保存」
```

**期望**：

- 保存成功后页面刷新，显示新数据
- `toast.success("保存成功")`
- 成员 Tab 里的「成员数量」同步更新
- 非 OWNER/ROOT 用户看不到「编辑」按钮

### 6.2 成员 Tab 添加/移除

```bash
# 打开项目详情页 → 成员 Tab
# 点击「添加成员」→ 弹窗列出不在此项目的用户
# 勾选某人 → 选择角色 → 点击添加
```

**期望**：

- 添加成功后成员列表立即刷新，新成员出现
- 若该成员已在项目中：toast.error("MEMBER_EXISTS")
- 移除最后一名 OWNER：toast.error("至少保留一名负责人")，请求返回 409 LAST_OWNER

### 6.3 团队页面切换

```bash
# 打开 http://localhost:3003/team
# 点击「全部成员」Tab → URL 变为 ?view=all
# 页面显示每人一卡，卡内列出参与项目链接
```

**期望**：

- `?view=projects` → 现有按项目视角不变
- `?view=all` → 全部成员视角，卡内项目链接可点击跳转
- 刷新页面保持当前视图

---

## 7. 复现 Checklist

- [ ] 以 ROOT 或项目 OWNER 登录
- [ ] 进入项目详情页，确认「编辑项目」按钮可见
- [ ] 点击编辑，修改名称/描述/状态/负责人，保存后数据刷新
- [ ] 以普通成员（非 OWNER）登录，确认「编辑」按钮不显示
- [ ] 进入成员 Tab，点击「添加成员」，选人+选角色，添加成功
- [ ] 尝试添加已在项目的成员，确认提示
- [ ] 尝试移除最后一名 OWNER，确认拒绝
- [ ] 切换角色 OWNER → MEMBER，确认成功且项目 ownerId 同步
- [ ] 打开 `/team`，点击「全部成员」Tab，确认每人一张卡
- [ ] 确认卡内项目链接可正常跳转
- [ ] `npx tsc --noEmit` 无本次引入的新错误

---

## 8. 踩坑记录

### 坑 1：ZodError 类型断言

**现象**：`error.errors` 在 `error instanceof z.ZodError` 分支中报 `Property 'errors' does not exist on type 'ZodError<unknown>'`。

**原因**：Zod 版本类型定义中 `ZodError<unknown>` 与 `ZodError<T>` 推断不一致，直接 `instanceof` 断不开。

**解法**：改用 `safeParse()`，在 `!success` 时直接返回 400，避免在 catch 块里做 Zod 类型断言：

```16:22:app/api/projects/[id]/members/route.ts
const parseResult = addMemberSchema.safeParse(body);
if (!parseResult.success) {
  return NextResponse.json({ error: "Invalid input" }, { status: 400 });
}
const { userId, role } = parseResult.data;
```

### 坑 2：`OverviewTab` 替换时 `InfoRow` 函数丢失

**现象**：将 `OverviewTab` 替换为带编辑功能的受控组件时，`InfoRow` 函数被意外删除。

**原因**：旧 `OverviewTab` 内有 `InfoRow`，替换整个函数块时漏了 `InfoRow`。

**解法**：在文件顶部（在所有组件之前）单独添加 `InfoRow` 函数，确保非编辑模式下仍能渲染只读行。

### 坑 3：历史遗留 tsc 错误（无需本次修复）

**现象**：`features/admin/admin.test.ts` 有 16 处 `Cannot find module '@/lib/db'`；`e2e/module-edit.spec.ts` 有 Playwright 类型错误。

**原因**：测试文件长期未维护，依赖路径和 Playwright 版本不匹配。

**解法**：已在 Risks 中列明，本次改动未引入此类错误，不属于本次范围。

---

## 附录：API 错误码

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| `LAST_OWNER` | 409 | 不能移除最后一名负责人 |
| `MEMBER_EXISTS` | 409 | 成员已在项目中 |
| `FORBIDDEN` | 403 | 无权操作 |
| `User not found` | 404 | 目标用户不存在 |
| `Member not found` | 404 | 成员记录不存在 |

## 附录：权限矩阵

| 操作 | ROOT | 项目 OWNER | 其他成员 |
|------|------|-----------|---------|
| 编辑项目基本信息 | ✅ | ✅ | ❌ |
| 添加/移除项目成员 | ✅ | ✅ | ❌ |
| 切换成员角色 | ✅ | ✅ | ❌ |
| 查看项目成员 | ✅ | ✅ | ✅ |

---

## 修复记录 (Round 2)

> code-reviewer round 1 发现，本轮修复了以下 4 项，Optional 跳过。

### 修复 1 (Must-Fix):编辑按钮权限守卫

- **问题**：`ProjectDetail.tsx` 第 759-772 行，"编辑项目"按钮无条件渲染，非 OWNER/ROOT 用户可见但后端会拒绝保存。
- **修复**：用 `canEditProject` 变量（已在第 693 行定义：`userIsRoot || isOwner`）包裹按钮，非授权用户不再看到按钮。
- **文件**: `features/project/ui/ProjectDetail.tsx`:759

### 修复 2 (Should-Fix):负责人下拉 fetch 加错误提示

- **问题**：`OverviewTab` 第 313-318 行，`fetch("/api/users").catch(() => {})` 静默吞错，列表加载失败用户无感知。
- **修复**：加了 `toast.error("负责人列表加载失败")` + `cancelled` flag 防止组件卸载后 setState。
- **文件**: `features/project/ui/ProjectDetail.tsx`:305-319

### 修复 3 (Should-Fix):ownerId 变更补 ModerationLog

- **问题**：`app/api/projects/[id]/route.ts` PATCH ownerId 事务内未写 `ModerationLog`，负责人变更无法审计。
- **修复**：事务末尾追加 `tx.moderationLog.create`，action 复用 `CREATE_PROJECT`，reason 写明 `转移项目负责人: oldOwnerName → newOwnerName`；预先在事务外查询新旧负责人姓名。
- **文件**: `app/api/projects/[id]/route.ts`:107-155

### 修复 4 (Should-Fix):FSD 边界——getAllTeamMembersAction 迁移

- **问题**：`getAllTeamMembersAction` 放在 `features/profile/lib/profile-actions.ts`，不符合 FSD（应为 team 维度）。
- **修复**：迁移至 `features/team/lib/team-actions.ts`；更新 `app/team/page.tsx` 和 `features/team/ui/ProfileAllMembers.tsx` 的导入源。
- **文件**:
  - `features/team/lib/team-actions.ts` (新增)
  - `features/profile/lib/profile-actions.ts` (删除)
  - `app/team/page.tsx`:6 (修改 import)
  - `features/team/ui/ProfileAllMembers.tsx`:2 (修改 import)

### 跳过 (Optional)

- 🟢 **Optional #5**: 虚拟列表/分页 — 暂不修，列为 TODO
- 🟢 **Optional #6**: `/api/team/members` 权限范围 — 主代理决定保留 `requireSession`

### tsc 验证

```bash
npx tsc --noEmit
```

**结果**：0 新增错误。现有错误为 pre-existing（`features/admin/admin.test.ts` 的 `@/lib/db` 路径问题 + `e2e/module-edit.spec.ts` 的 Playwright 类型错误），已在 PR6 文档坑 3 记录，本次修复未引入任何新错误。

---

## 修复记录 (Round 3 - Build Error)

> Next.js 16.2.6 Turbopack build fail：client bundle 中出现 `server-only` 依赖。

### 问题根因

`shared/lib/permissions.ts` 混揉了**纯函数**（`isRoot`/`isBanned`/`canManageUser`）与 **server-only 函数**（`requireSession` 等），而文件顶部 `import { prisma } from "@/shared/db/client"` 间接引入了 `@/lib/auth`（含 `server-only`）。

当 `features/project/ui/ProjectDetail.tsx` 静态 import `isRoot` 时，Next.js Turbopack 将整个 `permissions.ts` 链入 client bundle，检测到 `server-only` 后直接 build fail：

```
./lib/auth.ts:1:1
You're importing a module that depends on "server-only".
> 1 | import "server-only";
```

### 修复方案

将纯函数拆出到独立的 `permissions-client.ts`，server-only 模块加 `import "server-only"` 守卫，client/middleware 改 import 源。

### 改动文件清单

#### 新增

| 文件 | 说明 |
|------|------|
| `shared/lib/permissions-client.ts` | 只含纯函数：`isRoot`、`isBanned`、`canManageUser`，0 外部依赖 |

#### 修改

| 文件 | 改动 |
|------|------|
| `shared/lib/permissions.ts` | 删除 `isRoot`/`isBanned`/`canManageUser`；顶部加 `import "server-only"` 守卫 |
| `features/project/ui/ProjectDetail.tsx:24` | `isRoot` import 源改为 `@/shared/lib/permissions-client` |
| `middleware.ts:2` | `isRoot` import 源改为 `@/shared/lib/permissions-client` |
| `app/api/admin/moderation/route.ts:3` | `isRoot` import 源改为 `@/shared/lib/permissions-client` |
| `app/admin/layout.tsx:5` | `isRoot` import 源改为 `@/shared/lib/permissions-client` |

#### 未改动（保持 `@/shared/lib/permissions`）

所有 API route / server action / RSC（使用 `requireSession`/`requireRoot`/`requireProjectEditor`/`requireDesignResponsibility` 的 46 处引用），均保持在 `permissions.ts` 中。

### 关键设计决策

- **`permissions-client.ts` 无任何 import**：纯 TypeScript 函数，不依赖 Prisma / NextAuth，确保永远不会被 `server-only` 守卫拦截。
- **`permissions.ts` 顶部加 `import "server-only"`**：防御性措施，防止将来有 client component 错误地静态 import server 函数，Turbopack 会在 build 时直接报错而非静默带病上线。
- **`app/admin/layout.tsx` 虽是 RSC 但改用 `permissions-client`**：虽然 RSC 可以 import server-only 模块，但它只用了纯函数，没必要引入额外依赖链，保持最小引用原则。

### 验证结果

**tsc**：`npx tsc --noEmit` → 0 新增错误，仅剩 pre-existing（`admin.test.ts` 的 `@/lib/db` + `e2e/module-edit.spec.ts` 的 Playwright 类型）。

**next build**：`npx next build` → exit code 0，所有 route 正常编译，无 server-only 报错。
