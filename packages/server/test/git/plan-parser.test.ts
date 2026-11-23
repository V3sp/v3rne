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

describe("parseMarkdownHeadings — sekcje", () => {
  const SECTIONS = [
    "# Plan",
    "",
    "Wstęp.",
    "",
    "## Faza 1",
    "Treść fazy.",
    "",
    "### Zadanie",
    "- punkt",
    "",
    "#### Poziom czwarty",
    "ukryty w sekcji",
    "",
    "## Faza 2",
    "Treść fazy 2.",
  ].join("\n");

  test("a section includes the content of its subsections", () => {
    const faza1 = parseMarkdownHeadings(SECTIONS).find((h) => h.title === "Faza 1");

    expect(faza1?.content).toBe(
      "Treść fazy.\n\n### Zadanie\n- punkt\n\n#### Poziom czwarty\nukryty w sekcji",
    );
    expect(faza1?.endLine).toBe(12);
  });

  test("the next heading of the same level ends the previous section", () => {
    const headings = parseMarkdownHeadings(SECTIONS);
    const faza1 = headings.find((h) => h.title === "Faza 1");
    const faza2 = headings.find((h) => h.title === "Faza 2");

    expect(faza1?.content).not.toContain("Faza 2");
    expect(faza2?.line).toBe(14);
    expect(faza2?.endLine).toBe(15);
    expect(faza2?.content).toBe("Treść fazy 2.");
  });

  test("the last section runs to the end of the file", () => {
    const content = "## Ostatnia\nlinia 1\n\nlinia 2\n";
    const [heading] = parseMarkdownHeadings(content);

    expect(heading?.content).toBe("linia 1\n\nlinia 2");
    expect(heading?.endLine).toBe(4);
  });

  test("an empty section has empty content and endLine equal to its line", () => {
    const headings = parseMarkdownHeadings("## Pusta\n\n## Następna\nTreść\n");

    expect(headings[0]).toMatchObject({ title: "Pusta", line: 1, endLine: 1, content: "" });
    expect(headings[1]).toMatchObject({ title: "Następna", content: "Treść" });
  });

  test("handles CRLF sections without carriage returns in the content", () => {
    const headings = parseMarkdownHeadings(
      "# Plan\r\n\r\n## A\r\nTreść A\r\n\r\n### A1\r\nTreść A1\r\n\r\n## B\r\n",
    );

    const a = headings.find((h) => h.title === "A");
    expect(a?.content).toBe("Treść A\n\n### A1\nTreść A1");
    expect(a?.endLine).toBe(7);
    expect(headings.find((h) => h.title === "B")).toMatchObject({
      endLine: 9,
      content: "",
    });
  });

  test("a heading inside a fenced code block does not end the section", () => {
    const [heading] = parseMarkdownHeadings("## A\n```md\n## nie nagłówek\n```\n");
    expect(heading?.content).toBe("```md\n## nie nagłówek\n```");
  });
});
