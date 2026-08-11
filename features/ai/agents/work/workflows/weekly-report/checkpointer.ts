/**
 * Weekly Report Workflow — Checkpointer
 *
 * 迁移自 features/ai/workflow/runtime.ts
 */

import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";

type GlobalCheckpoint = typeof globalThis & {
  __workflow_checkpointer?: BaseCheckpointSaver;
  __workflow_checkpointer_setup?: Promise<void>;
};

function usePostgres(): boolean {
  if (process.env.WORKFLOW_CHECKPOINT === "postgres") return true;
  if (process.env.WORKFLOW_CHECKPOINT === "memory") return false;
  return process.env.NODE_ENV === "production";
}

async function createCheckpointer(): Promise<BaseCheckpointSaver> {
  if (!usePostgres()) {
    return new MemorySaver();
  }

  const connString = process.env.DATABASE_URL;
  if (!connString) {
    console.warn(
      "[workflow/checkpointer] DATABASE_URL missing — falling back to MemorySaver"
    );
    return new MemorySaver();
  }

  const { PostgresSaver } = await import(
    "@langchain/langgraph-checkpoint-postgres"
  );
  const saver = PostgresSaver.fromConnString(connString, { schema: "pm" });
  await saver.setup();
  return saver;
}

export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  const g = globalThis as GlobalCheckpoint;
  if (g.__workflow_checkpointer) {
    return g.__workflow_checkpointer;
  }

  if (!g.__workflow_checkpointer_setup) {
    g.__workflow_checkpointer_setup = createCheckpointer().then((cp) => {
      g.__workflow_checkpointer = cp;
    });
  }

  await g.__workflow_checkpointer_setup;
  return g.__workflow_checkpointer!;
}

export function resetCheckpointerCache(): void {
  const g = globalThis as GlobalCheckpoint;
  delete g.__workflow_checkpointer;
  delete g.__workflow_checkpointer_setup;
}
