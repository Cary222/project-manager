import { NextRequest, NextResponse } from "next/server";
import { isNewerStableVersion, getPiWebReleaseUrl } from "@/lib/app-update";

export async function GET() {
  const currentVersion = process.env.npm_package_version ?? "0.0.0";

  // 最新稳定版本从 GitHub releases 获取（缓存 1 小时）
  // 这里简化处理：实际可调用 GitHub API
  const latestVersion = currentVersion; // 占位，需接入 GitHub API
  const updateAvailable = isNewerStableVersion(latestVersion, currentVersion);
  const releaseUrl = updateAvailable ? getPiWebReleaseUrl(latestVersion) : null;

  return NextResponse.json({
    updateAvailable,
    currentVersion,
    latestVersion,
    releaseUrl,
  });
}
