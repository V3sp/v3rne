export type PlanHeadingLevel = 1 | 2 | 3;

export interface PlanHeading {
  level: PlanHeadingLevel;
  title: string;
  /** GitHub-style anchor (without the leading `#`). */
  slug: string;
  /** 1-based line number in the source file. */
  line: number;
}

const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_REGEX = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const MAX_LEVEL: PlanHeadingLevel = 3;

/**
 * Returns headings in document order. The `level` field carries the nesting,
 * so callers can render a tree without a nested structure.
 * Headings inside fenced code blocks and levels deeper than `###` are ignored.
 */
export function parseMarkdownHeadings(content: string): PlanHeading[] {
  const headings: PlanHeading[] = [];
  let openFence: { char: string; length: number } | null = null;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    // CRLF files keep a trailing `\r` after splitting on `\n`.
    const line = (lines[index] ?? "").replace(/\r$/, "");

    const fenceMatch = FENCE_REGEX.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      const char = marker[0] ?? "`";
      if (!openFence) {
        openFence = { char, length: marker.length };
      } else if (openFence.char === char && marker.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }
    if (openFence) continue;

    const headingMatch = HEADING_REGEX.exec(line);
    if (!headingMatch) continue;

    const level = (headingMatch[1] ?? "").length;
    if (level > MAX_LEVEL) continue;

    const title = (headingMatch[2] ?? "").trim();
    if (!title) continue;

    headings.push({
      level: level as PlanHeadingLevel,
      title,
      slug: slugifyHeading(title),
      line: index + 1,
    });
  }

  return headings;
}

/**
 * GitHub-like anchor: lowercase, punctuation removed, whitespace collapsed to
 * hyphens. Unicode letters (including Polish diacritics) are preserved.
 */
export function slugifyHeading(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}
