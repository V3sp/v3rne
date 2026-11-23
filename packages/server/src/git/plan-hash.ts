export interface DriftState {
  drift: boolean;
  /** SHA-256 of the normalized current content. */
  hash: string;
}

/** CRLF → LF, so the same file hashes identically regardless of checkout settings. */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function sha256Hex(content: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(normalizeLineEndings(content));
  return hasher.digest("hex");
}

/**
 * A missing stored hash means the plan has never been acknowledged: the first
 * ack sets the baseline, so it is not drift.
 */
export function detectDrift(stored: string | undefined, currentContent: string): DriftState {
  const hash = sha256Hex(currentContent);
  if (!stored) return { drift: false, hash };
  return { drift: stored !== hash, hash };
}
