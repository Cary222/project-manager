---
name: pm-ops
description: >-
  Build, restart, and deploy project-manager on port 3003 with LAN access.
  Use when restarting the service, fixing localhost redirects, database push,
  or git remote operations for this project.
---

# project-manager 运维

## 构建与重启

```bash
cd /home/hxy/work/personal/project-manager
npm run build
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start
```

生产用 `npm run start`；开发用 `npm run dev --webpack`。

## 局域网跳转 localhost

根因：`.env` 中设置了 `AUTH_URL` 或 `NEXTAUTH_URL`。
删除这两项，保留 `AUTH_TRUST_HOST=true`，重启即可。

## 数据库

```bash
npx prisma db push          # 同步 schema
npm run db:seed             # 仅 Counter，不创建默认用户
npx prisma studio           # 可视化管理
```

## Git 远端

- bare：`/home/hxy/work/personal/project-manager.git`
- 工作区：`/home/hxy/work/personal/project-manager`

## 扫描路径

Git 提交同步固定扫描：

- `/home/hxy/work/company/*`
- `/home/hxy/work/personal/*`

提交格式：`10012: 描述`
