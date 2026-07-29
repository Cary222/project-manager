/**
 * Browser-compatible SHA-256 file hashing utilities.
 * Used by upload.ts to compute client-side file hash as a hint for deduplication.
 */

/**
 * Compute SHA-256 hash of a File/Blob.
 * Returns null if crypto.subtle is unavailable (non-secure context).
 */
export async function sha256File(file: Blob): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }

  try {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  } catch {
    return null;
  }
}

/**
 * Compute SHA-256 hash of a string.
 */
export async function sha256String(text: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return hashHex;
  } catch {
    return null;
  }
}
