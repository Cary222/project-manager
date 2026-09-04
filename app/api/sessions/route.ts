import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { isPiOwnershipEnabled } from "@/features/ai/pi-integration/feature-flags";
import { listOwnedPiSessionIds } from "@/features/ai/pi-integration/pi-session-ownership";
import {
  attachSessionProjectInfo,
  listAllSessions,
  mergeSessionLists,
} from "@/lib/session-reader";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRpcSessionInfos,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const authSession = await requireSession();
    const force = new URL(req.url).searchParams.get("force") === "1";
    const [persistedSessions, runtimeSessions] = await Promise.all([
      listAllSessions({ force }),
      attachSessionProjectInfo(getRpcSessionInfos()),
    ]);
    const allSessions = mergeSessionLists(persistedSessions, runtimeSessions);
    const ownedIds = isPiOwnershipEnabled()
      ? await listOwnedPiSessionIds(authSession.user.id)
      : null;
    const sessions = ownedIds
      ? allSessions.filter((session) => ownedIds.has(session.id))
      : allSessions;
    const runningSessionIds = getRunningRpcSessionIds();
    return NextResponse.json(
      {
        sessions,
        runningSessionIds: ownedIds
          ? runningSessionIds.filter((sessionId) => ownedIds.has(sessionId))
          : runningSessionIds,
        completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds().filter(
          (sessionId) => !ownedIds || ownedIds.has(sessionId),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json(
      { error: msg },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
