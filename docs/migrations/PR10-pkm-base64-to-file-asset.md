# PR10: PKM Base64 附件迁移

## 背景

PR10 引入四层文件架构，`PkmNote.attachments` 从旧的 base64 data URL 格式迁移到新的 `fileId` 引用格式。

## 旧格式 vs 新格式

### 旧格式（Legacy）
```json
{
  "attachments": [
    {
      "name": "screenshot.png",
      "url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA...",
      "mimeType": "image/png",
      "size": 12345
    }
  ]
}
```

### 新格式（PR10）
```json
{
  "attachments": [
    {
      "fileId": "clx1234abcd",
      "name": "screenshot.png",
      "mimeType": "image/png",
      "size": 12345
    }
  ]
}
```

## 前置条件

### 1. 数据库备份（必须）

```bash
# 导出当前数据库
pg_dump $DB_NAME > backup_before_pkm_migration_$(date +%Y%m%d_%H%M%S).sql

# 或使用 prisma migrate status 查看当前状态
npx prisma migrate status
```

### 2. 确认环境变量

确保 `DATABASE_URL` 正确指向目标数据库。

## 执行步骤

### 第一步：Dry Run 预览

先跑一次 dry-run 查看有多少笔记需要迁移：

```bash
npm run migrate:pkm-attachments -- --dry-run
```

预期输出：
```
📊 总待处理 note 数: 42, batch size: 50, dry-run: true
  [dry-run] note=clx1xxxxx legacy_attachments=2
  [dry-run] note=clx2xxxxx legacy_attachments=1
  ...
🏁 完成: processed=42 failed=0
（dry-run 模式未写入任何数据）
```

### 第二步：执行迁移

确认 dry-run 结果无误后，执行真实迁移：

```bash
npm run migrate:pkm-attachments
```

预期输出：
```
⚠️  警告：此脚本会修改 PkmNote.attachments 和 FileReference 表
   建议先执行: pg_dump <DB_NAME> > backup.sql
   --dry-run 可先跑一次预览

📂 Starting fresh migration (no state file found)
📊 总待处理 note 数: 42, batch size: 50, dry-run: false
  ✅ note=clx1xxxxx converted=2
  ✅ note=clx2xxxxx converted=1
📈 进度: 2 / 42 (failed: 0)
  ✅ note=clx3xxxxx converted=3
...
🏁 完成: processed=42 failed=0
```

### 第三步：断点续跑（如中断）

如果迁移过程中断，可使用 `--resume` 从断点继续：

```bash
npm run migrate:pkm-attachments -- --resume
```

脚本会自动读取 `scripts/.migrate-pkm-base64-attachments.state.json` 中的断点信息。

### 高级参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--dry-run` | 只统计不写入 | false |
| `--batch-size=N` | 每批处理的 note 数量 | 50 |
| `--resume` | 从断点续跑 | false |

组合使用示例：
```bash
# 大批量时减小 batch size
npm run migrate:pkm-attachments -- --batch-size=20

# 带断点续跑 + 小批次
npm run migrate:pkm-attachments -- --resume --batch-size=10
```

## State 文件

脚本在 `scripts/.migrate-pkm-base64-attachments.state.json` 保存断点状态：

```json
{
  "lastProcessedNoteId": "clx1xxxxx",
  "processedCount": 15,
  "failedCount": 0,
  "startedAt": "2026-07-01T12:00:00.000Z",
  "updatedAt": "2026-07-01T12:05:00.000Z"
}
```

- **注意**：dry-run 模式不会写入 state 文件
- 删除 state 文件后重新运行会自动退化为全量迁移

## 回滚方案

如需回滚，使用备份恢复：

```bash
# 停止服务
# ...

# 恢复数据库
psql $DB_NAME < backup_before_pkm_migration_20260701_120000.sql

# 重启服务
```

## 验证

迁移完成后，可运行验收测试确认功能正常：

```bash
npm run test:acceptance
```

或手动检查：
1. 打开一个历史笔记，附件应正常显示
2. 查看 `FileReference` 表应有 `sourceType = 'PKM_NOTE'` 的记录
3. 查看 `FileAsset` 表应有新创建的记录
