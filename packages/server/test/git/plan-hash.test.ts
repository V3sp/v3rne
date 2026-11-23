import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { detectDrift, normalizeLineEndings, sha256Hex } from "../../src/git/plan-hash";

describe("plan-hash", () => {
  test("CRLF and LF produce the same hash", () => {
    expect(sha256Hex("# Plan\r\n\r\n## Faza 1\r\n")).toBe(sha256Hex("# Plan\n\n## Faza 1\n"));
  });

  test("normalization only rewrites CRLF", () => {
    expect(normalizeLineEndings("a\r\nb\nc")).toBe("a\nb\nc");
  });

  test("hash matches node:crypto sha256 of the normalized content", () => {
    const content = "# Plan\r\n## Faza 1\r\n";
    const expected = createHash("sha256").update("# Plan\n## Faza 1\n").digest("hex");
    expect(sha256Hex(content)).toBe(expected);
  });

  test("no stored hash means no drift", () => {
    const state = detectDrift(undefined, "# Plan\n");
    expect(state.drift).toBe(false);
    expect(state.hash).toBe(sha256Hex("# Plan\n"));
  });

  test("empty stored hash is treated as no baseline", () => {
    expect(detectDrift("", "# Plan\n").drift).toBe(false);
  });

  test("unchanged content is not drift", () => {
    const content = "# Plan\n\n## Faza 1\n";
    expect(detectDrift(sha256Hex(content), content)).toEqual({
      drift: false,
      hash: sha256Hex(content),
    });
  });

  test("CRLF content with an LF baseline is not drift", () => {
    const baseline = sha256Hex("# Plan\n## Faza 1\n");
    expect(detectDrift(baseline, "# Plan\r\n## Faza 1\r\n").drift).toBe(false);
  });

  test("changed content is drift", () => {
    const baseline = sha256Hex("# Plan\n");
    expect(detectDrift(baseline, "# Plan\n\n## Nowa sekcja\n").drift).toBe(true);
  });
});
