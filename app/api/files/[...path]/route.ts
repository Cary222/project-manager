import { NextRequest, NextResponse } from "next/server";
import { listFiles } from "@/lib/directory-browser";
import { getAllowedFileRoots, allowFileRoot, isFilePathAllowed } from "@/lib/file-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: pathParts } = await params;
    const decoded = pathParts.map((p) => decodeURIComponent(p));
    const filePath = "/" + decoded.join("/");
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "list";

    let allowedRoots = await getAllowedFileRoots();
    // When no sessions have been created yet, allowedRoots is empty and every
    // browse request would be denied. Bootstrap with the current project root.
    if (allowedRoots.size === 0) {
      const projectRoot = process.cwd();
      allowFileRoot(projectRoot);
      allowedRoots = await getAllowedFileRoots();
    }
    if (!isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const result = await listFiles(filePath, type, searchParams);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
