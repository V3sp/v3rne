export type PlanHeadingLevel = 1 | 2 | 3;

export interface PlanHeading {
  level: PlanHeadingLevel;
  title: string;
  /** GitHub-style anchor (without the leading `#`). */
  slug: string;
  /** 1-based line number in the source file. */
  line: number;
  /** 1-based number of the section's last non-blank line; equal to `line` for an empty section. */
  endLine: number;
  /** Section markdown without the heading line, trimmed; an empty string when there is no body. */
  content: string;
}

interface HeadingSeed {
  level: PlanHeadingLevel;
  title: string;
  slug: string;
  line: number;
}

const FENCE_REGEX = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_REGEX = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const MAX_LEVEL: PlanHeadingLevel = 3;

/**
 * Returns headings in document order. The `level` field carries the nesting,
 * so callers can render a tree without a nested structure.
 * Each heading also carries the content of its section, which runs until the
 * next heading of the same or a higher level (subsections stay inside).
 * Headings inside fenced code blocks and levels deeper than `###` are ignored.
 */
export function parseMarkdownHeadings(content: string): PlanHeading[] {
  const seeds: HeadingSeed[] = [];
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

    seeds.push({
      level: level as PlanHeadingLevel,
      title,
      slug: slugifyHeading(title),
      line: index + 1,
    });
  }

  return seeds.map((seed, seedIndex) => {
    const next = seeds.find(
      (candidate, candidateIndex) => candidateIndex > seedIndex && candidate.level <= seed.level,
    );
    // 0-based index of the first body line is `seed.line`; the body ends before the next heading.
    const body = lines
      .slice(seed.line, next ? next.line - 1 : lines.length)
      .map((line) => line.replace(/\r$/, ""));

    let lastNonBlank = -1;
    for (let index = 0; index < body.length; index += 1) {
      if ((body[index] ?? "").trim().length > 0) lastNonBlank = index;
    }

    return {
      ...seed,
      endLine: lastNonBlank === -1 ? seed.line : seed.line + lastNonBlank + 1,
      content: body.join("\n").trim(),
    };
  });
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
