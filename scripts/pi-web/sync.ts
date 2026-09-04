import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface ManifestFile {
  source: string;
  target: string;
  sha256: string;
  rewrite?: Record<string, string>;
}

interface Manifest {
  vendorRoot: string;
  activeRoot: string;
  files: ManifestFile[];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const [command] = process.argv.slice(2);
  if (command !== "materialize") {
    throw new Error("Usage: tsx scripts/pi-web/sync.ts materialize");
  }

  const root = process.cwd();
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(root, "scripts/pi-web/manifest.json"), "utf8"),
    ) as Manifest;
  } catch (error) {
    throw new Error(
      `Invalid Pi Web manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(
      "Manifest has no reviewed file mappings; refusing to materialize.",
    );
  }

  for (const file of manifest.files) {
    const source = path.resolve(root, manifest.vendorRoot, file.source);
    const target = path.resolve(root, manifest.activeRoot, file.target);
    if (
      !source.startsWith(path.resolve(root, manifest.vendorRoot) + path.sep) ||
      !target.startsWith(path.resolve(root, manifest.activeRoot) + path.sep)
    ) {
      throw new Error(`Unsafe mapping: ${file.source} -> ${file.target}`);
    }
    if (!existsSync(source))
      throw new Error(`Missing vendor file: ${file.source}`);

    let content = await readFile(source, "utf8");
    for (const [from, to] of Object.entries(file.rewrite ?? {})) {
      content = content.replaceAll(from, to);
    }
    if (sha256(content) !== file.sha256) {
      throw new Error(`Hash mismatch after rewrite: ${file.target}`);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { force: true });
    await writeFile(target, content);
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
