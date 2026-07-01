#!/usr/bin/env tsx
/**
 * PR10 历史 PKM base64 附件迁移脚本
 *
 * 功能：
 * 1. 扫描所有 PkmNote，找到 attachments[].url 是 data:base64 的旧格式
 * 2. 转换 base64 → 上传到 FileAsset（按 hash 去重）
 * 3. 更新 PkmNote.attachments 为新格式 [{ fileId, ... }]
 * 4. 双写 FileReference (sourceType: PKM_NOTE)
 *
 * 参数：
 *   --dry-run        只统计不写入，输出 JSON 报告
 *   --batch-size=N   分批大小（默认 50）
 *   --resume         读 state 文件从断点续跑（state 不存在则退化全量）
 *
 * state 文件：scripts/.migrate-pkm-base64-attachments.state.json
 *   { lastProcessedNoteId, processedCount, failedCount, startedAt, updatedAt }
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadEnvConfig } from "@next/env"
import { prisma } from "../shared/db/client"
import { extractFileAttachmentsFromLegacy } from "../shared/lib/pkm"
import { recordFileReference } from "../shared/lib/file-reference"
import type { Prisma } from "@prisma/client"

// 加载环境变量
loadEnvConfig(process.cwd())

const STATE_FILE = resolve(process.cwd(), "scripts", ".migrate-pkm-base64-attachments.state.json")
const BATCH_DEFAULT = 50

type State = {
  lastProcessedNoteId: string
  processedCount: number
  failedCount: number
  startedAt: string
  updatedAt: string
}

type Args = {
  dryRun: boolean
  batchSize: number
  resume: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = {
    dryRun: false,
    batchSize: BATCH_DEFAULT,
    resume: false,
  }
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true
    else if (a === "--resume") args.resume = true
    else if (a.startsWith("--batch-size=")) {
      const n = Number(a.split("=")[1])
      if (!Number.isFinite(n) || n <= 0) throw new Error(`INVALID_BATCH_SIZE: ${a}`)
      args.batchSize = n
    } else throw new Error(`UNKNOWN_ARG: ${a}`)
  }
  return args
}

function readState(): State | null {
  if (!existsSync(STATE_FILE)) return null
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State
  } catch {
    return null
  }
}

function writeState(state: State): void {
  state.updatedAt = new Date().toISOString()
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8")
}

function hasLegacyBase64Attachments(attachments: unknown): boolean {
  if (!Array.isArray(attachments)) return false
  for (const att of attachments) {
    if (att && typeof att === "object" && typeof (att as Record<string, unknown>).url === "string") {
      const url = (att as Record<string, unknown>).url as string
      if (url.startsWith("data:")) return true
    }
  }
  return false
}

function countLegacyBase64Attachments(attachments: unknown): number {
  if (!Array.isArray(attachments)) return 0
  let count = 0
  for (const att of attachments) {
    if (att && typeof att === "object" && typeof (att as Record<string, unknown>).url === "string") {
      const url = (att as Record<string, unknown>).url as string
      if (url.startsWith("data:")) count++
    }
  }
  return count
}

async function main() {
  const args = parseArgs()

  // 1. 提示备份
  if (!args.dryRun) {
    console.log("⚠️  警告：此脚本会修改 PkmNote.attachments 和 FileReference 表")
    console.log("   建议先执行: pg_dump <DB_NAME> > backup.sql")
    console.log("   --dry-run 可先跑一次预览")
    console.log()
  }

  // 2. 决定起始点
  let startAfter: string | undefined
  let processedCount = 0
  let failedCount = 0
  let startedAt = new Date().toISOString()

  if (args.resume) {
    const state = readState()
    if (state) {
      console.log(`📂 Resuming from state: lastProcessedNoteId=${state.lastProcessedNoteId} processedCount=${state.processedCount}`)
      startAfter = state.lastProcessedNoteId
      processedCount = state.processedCount
      failedCount = state.failedCount
      startedAt = state.startedAt
    } else {
      console.log("⚠️  --resume 但 state 文件不存在，自动退化为全量迁移")
    }
  }

  // 3. 计算总数（用于进度显示）
  const totalWithLegacy = await prisma.pkmNote.count({
    where: startAfter ? { id: { gt: startAfter } } : {},
  })

  console.log(`📊 总待处理 note 数: ${totalWithLegacy}, batch size: ${args.batchSize}, dry-run: ${args.dryRun}`)

  // 4. 分批处理
  let cursor = startAfter ?? ""
  let processed = processedCount
  let failed = failedCount

  while (true) {
    const batch = await prisma.pkmNote.findMany({
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: "asc" },
      take: args.batchSize,
      select: { id: true, userId: true, attachments: true },
    })
    if (batch.length === 0) break

    for (const note of batch) {
      const attachments = note.attachments as unknown

      // 找出 base64 旧格式
      if (!hasLegacyBase64Attachments(attachments)) {
        cursor = note.id
        continue
      }

      try {
        if (args.dryRun) {
          const count = countLegacyBase64Attachments(attachments)
          console.log(`  [dry-run] note=${note.id} legacy_attachments=${count}`)
        } else {
          // 真实转换
          const { attachments: newAttachments, convertedFileIds } = await extractFileAttachmentsFromLegacy(
            attachments,
            note.userId,
          )

          if (newAttachments.length > 0) {
            await prisma.$transaction(async (tx) => {
              await tx.pkmNote.update({
                where: { id: note.id },
                data: { attachments: newAttachments as unknown as Prisma.InputJsonValue },
              })
              for (const att of newAttachments) {
                await recordFileReference(tx, {
                  fileAssetId: att.fileId,
                  sourceType: "PKM_NOTE",
                  sourceId: note.id,
                })
              }
            })
            console.log(`  ✅ note=${note.id} converted=${convertedFileIds.length}`)
          }
        }
        processed++
      } catch (error) {
        failed++
        console.error(`  ❌ note=${note.id} failed: ${error instanceof Error ? error.message : "unknown"}`)
      }

      cursor = note.id
    }

    // 5. 保存断点
    if (!args.dryRun) {
      writeState({
        lastProcessedNoteId: cursor,
        processedCount: processed,
        failedCount: failed,
        startedAt,
        updatedAt: new Date().toISOString(),
      })
    }

    console.log(`📈 进度: ${processed} / ${totalWithLegacy} (failed: ${failed})`)
  }

  console.log(`\n🏁 完成: processed=${processed} failed=${failed}`)
  if (args.dryRun) {
    console.log("（dry-run 模式未写入任何数据）")
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("💥 脚本异常退出:", err)
    process.exit(1)
  })
