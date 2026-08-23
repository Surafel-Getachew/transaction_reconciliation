export const NDJSON_SNIFF_BYTES = 64 * 1024;

export class NdjsonSniffer {
  public static looksLikeNdjson(head: string, truncated = false): boolean {
    if (head.includes("\0")) {
      return false;
    }

    const lines = head.replace(/^﻿/, "").split("\n");
    const index = lines.findIndex((line) => line.trim().length > 0);
    if (index === -1) {
      return false;
    }

    const candidate = lines[index].trim();

    // The sniff window can cut the first record short; only its shape is knowable.
    if (truncated && index === lines.length - 1) {
      return candidate.startsWith("{");
    }

    try {
      const parsed = JSON.parse(candidate);
      return (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      );
    } catch {
      return false;
    }
  }
}
