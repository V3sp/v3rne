import { describe, expect, test } from "bun:test";
import { parseMarkdownHeadings, slugifyHeading } from "../../src/git/plan-parser";

const SAMPLE = `# Plan projektu

Wstęp bez nagłówka.

## Faza 1: Fundament
Treść.

### Zadanie: "API" (v2)
Treść.

#### Poziom czwarty jest ignorowany

\`\`\`md
## Nagłówek w bloku kodu
\`\`\`

## Kolejna sekcja ##
`;

describe("parseMarkdownHeadings", () => {
  test("extracts levels 1-3 in document order", () => {
    const headings = parseMarkdownHeadings(SAMPLE);
    expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 2]);
    expect(headings.map((h) => h.title)).toEqual([
      "Plan projektu",
      "Faza 1: Fundament",
      'Zadanie: "API" (v2)',
      "Kolejna sekcja",
    ]);
  });

  test("assigns github-like slugs and line numbers", () => {
    const headings = parseMarkdownHeadings(SAMPLE);
    expect(headings.map((h) => h.slug)).toEqual([
      "plan-projektu",
      "faza-1-fundament",
      "zadanie-api-v2",
      "kolejna-sekcja",
    ]);
    expect(headings[0]?.line).toBe(1);
    expect(headings[1]?.line).toBe(5);
  });

  test("ignores headings inside fenced code blocks (backticks and tildes)", () => {
    const content = [
      "# Real",
      "```",
      "# fake",
      "```",
      "~~~ts",
      "## fake too",
      "~~~",
      "## Real 2",
    ].join("\n");
    expect(parseMarkdownHeadings(content).map((h) => h.title)).toEqual(["Real", "Real 2"]);
  });

  test("keeps Polish diacritics in slugs", () => {
    expect(slugifyHeading("Zażółć gęślą jaźń")).toBe("zażółć-gęślą-jaźń");
    const [heading] = parseMarkdownHeadings("## Zażółć gęślą jaźń");
    expect(heading?.slug).toBe("zażółć-gęślą-jaźń");
  });

  test("does not treat hash-prefixed non-headings as headings", () => {
    expect(parseMarkdownHeadings("#Brake\n\n#").map((h) => h.title)).toEqual([]);
  });

  test("keeps a trailing hash that is part of the title", () => {
    const headings = parseMarkdownHeadings("### C#\n## Sekcja ##");
    expect(headings.map((h) => h.title)).toEqual(["C#", "Sekcja"]);
  });

  test("parses CRLF content", () => {
    expect(parseMarkdownHeadings("# Plan\r\n## Faza 1\r\n").map((h) => h.slug)).toEqual([
      "plan",
      "faza-1",
    ]);
  });
});
