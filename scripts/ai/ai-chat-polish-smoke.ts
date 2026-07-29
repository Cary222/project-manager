// Quick smoke test for the new PATCH endpoints. Skips HTTP, talks to the
// store layer + Prisma directly. Run with:
//   set -a && source .env.local && set +a && npx tsx scripts/ai-chat-polish-smoke.ts
import { prisma } from "@/shared/db/client";
import {
  listConversations,
  upsertProfile,
  getOrCreateProfile,
} from "@/features/ai/store/conversation-store";

async function main() {
  console.log("=== Test 1: listConversations returns tags field ===");
  const convs = await listConversations(
    // We don't know the userId ahead of time; pick the most recent conversation
    // across all users for the smoke check.
    (await prisma.aiConversation.findFirst({ orderBy: { lastMessageAt: "desc" } }))?.userId ?? ""
  );
  if (convs.length === 0) {
    console.log("No conversations in DB — skipping test 1");
  } else {
    const c = convs[0];
    console.log("first conv tags field:", c.tags);
    if (!Array.isArray(c.tags)) {
      throw new Error("FAIL: tags is not an array");
    }
    console.log("PASS");
  }

  console.log("\n=== Test 2: upsertProfile updates full profile ===");
  const userId = (await prisma.user.findFirst())?.id;
  if (!userId) {
    console.log("No users in DB — skipping test 2");
  } else {
    const marker = `__smoke_${Date.now()}`;
    await upsertProfile(userId, { roles: [marker], interests: ["X"] }, 0);
    const row = await getOrCreateProfile(userId);
    const profile = row?.profile as { roles?: string[] };
    if (!profile.roles?.includes(marker)) {
      throw new Error(`FAIL: marker not found in profile: ${JSON.stringify(profile)}`);
    }
    console.log("PASS — profile.roles =", profile.roles);

    // cleanup so we don't leave smoke data in the user's profile
    const cleaned = (profile.roles ?? []).filter((r) => r !== marker);
    await upsertProfile(userId, { ...profile, roles: cleaned }, 0);
    console.log("(cleaned up smoke marker)");
  }

  console.log("\n=== Test 3: prisma.aiConversation.update tags array ===");
  const conv = await prisma.aiConversation.findFirst();
  if (!conv) {
    console.log("No conversations — skipping test 3");
  } else {
    const marker = `__smoke_tag_${Date.now()}`;
    const originalTags = conv.tags;
    const next = [...originalTags, marker];
    const updated = await prisma.aiConversation.update({
      where: { id: conv.id },
      data: { tags: next },
    });
    if (!updated.tags.includes(marker)) {
      throw new Error("FAIL: marker not persisted");
    }
    console.log("PASS — tags now =", updated.tags);

    // cleanup
    await prisma.aiConversation.update({
      where: { id: conv.id },
      data: { tags: originalTags },
    });
    console.log("(restored original tags)");
  }

  await prisma.$disconnect();
  console.log("\nAll smoke tests passed.");
}

main().catch(async (e) => {
  console.error("Smoke test FAILED:", e);
  await prisma.$disconnect();
  process.exit(1);
});
