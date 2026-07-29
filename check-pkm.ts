import { prisma } from "./shared/db/client";

async function main() {
  // Check BLE_UUID_SUMMARY metadata
  const bleMeta = await prisma.$queryRaw`
    SELECT id, title, "metadata", ("metadata"->>'noteUserId') as nu, ("metadata"->>'noteIsPublic') as nip
    FROM pm."SearchDocument"
    WHERE title = 'BLE_UUID_SUMMARY'
  `;
  console.log("BLE_UUID_SUMMARY:", JSON.stringify(bleMeta, null, 2));

  // Count notes with/without embeddings
  const noteCov = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (WHERE "embedding" IS NOT NULL) as with_emb,
      COUNT(*) FILTER (WHERE "embedding" IS NULL) as without_emb,
      COUNT(*) as total
    FROM pm."SearchDocument"
  `;
  console.log("Note embedding coverage:", JSON.stringify(noteCov));

  // Get current user id
  const userId = "cmpuv1ota001rjlnkds1ckqe2";
  console.log("Viewer userId:", userId);

  // Check search results with this viewer
  const searchResult = await prisma.$queryRaw`
    SELECT d.id, d.title, d."metadata", ("metadata"->>'noteUserId') as nu
    FROM pm."SearchDocument" d
    WHERE d.title = 'BLE_UUID_SUMMARY'
  `;
  console.log("BLE_UUID_SUMMARY raw:", JSON.stringify(searchResult, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
