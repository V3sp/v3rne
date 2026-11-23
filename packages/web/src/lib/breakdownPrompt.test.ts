import { describe, expect, test } from "bun:test";
import { buildBreakdownPrompt } from "./breakdownPrompt";

const base = {
  projectId: "wfc",
  projectName: "Work Flow Console",
  planPath: "context/plan.md",
  sectionTitle: "Faza 1: Logowanie",
  level: 2 as const,
};

describe("buildBreakdownPrompt", () => {
  test("contains project name, id, plan file and section title", () => {
    const prompt = buildBreakdownPrompt(base);
    expect(prompt).toContain("Work Flow Console");
    expect(prompt).toContain('project_id: "wfc"');
    expect(prompt).toContain("context/plan.md");
    expect(prompt).toContain('"Faza 1: Logowanie"');
  });

  test("states the heading level", () => {
    const prompt = buildBreakdownPrompt({ ...base, level: 3 });
    expect(prompt).toContain("poziom nagłówka: 3 (H3)");
  });

  test("escapes double quotes in the section title", () => {
    const prompt = buildBreakdownPrompt({ ...base, sectionTitle: 'Krok "A" \\ B' });
    expect(prompt).toContain('plan_section: "Krok \\"A\\" \\\\ B"');
    expect(prompt).toContain('od nagłówka "Krok \\"A\\" \\\\ B"');
  });

  test("asks for create_tasks with plan_section, doubts and no duplicates", () => {
    const prompt = buildBreakdownPrompt(base);
    expect(prompt).toContain("create_tasks");
    expect(prompt).toContain("list_tasks");
    expect(prompt).toContain('kind="doubt"');
    expect(prompt).toContain("Nie twórz duplikatów");
    expect(prompt).toContain('"backlog"');
    expect(prompt).toContain('"ready"');
  });
});
