import { describe, expect, test } from "bun:test";
import { ApiError } from "../api/client";
import {
  createTaskErrorMessage,
  planSectionOptions,
  validateNewTaskDraft,
} from "./NewTaskModal";

describe("planSectionOptions", () => {
  test("mapuje nagłówki wszystkich plików planu na opcje sekcji", () => {
    const options = planSectionOptions({
      files: [
        {
          path: "plan.md",
          headings: [
            { title: "1. Silnik stanów", line: 4 },
            { title: "1.1. Wersjonowanie", line: 9 },
          ],
        },
        { path: "docs/phase-2.md", headings: [{ title: "4. Kolejkowanie", line: 2 }] },
      ],
    });

    expect(options).toEqual([
      {
        key: "plan.md:4",
        title: "1. Silnik stanów",
        planFile: "plan.md",
        label: "plan.md → 1. Silnik stanów",
      },
      {
        key: "plan.md:9",
        title: "1.1. Wersjonowanie",
        planFile: "plan.md",
        label: "plan.md → 1.1. Wersjonowanie",
      },
      {
        key: "docs/phase-2.md:2",
        title: "4. Kolejkowanie",
        planFile: "docs/phase-2.md",
        label: "docs/phase-2.md → 4. Kolejkowanie",
      },
    ]);
  });

  test("brak planu lub brak plików daje pustą listę", () => {
    expect(planSectionOptions(null)).toEqual([]);
    expect(planSectionOptions({ files: [] })).toEqual([]);
    expect(planSectionOptions({ files: [{ path: "plan.md", headings: [] }] })).toEqual([]);
  });

  test("klucz jest unikalny nawet przy powtarzającym się tytule w różnych plikach", () => {
    const options = planSectionOptions({
      files: [
        { path: "plan.md", headings: [{ title: "Start", line: 1 }] },
        { path: "docs/phase-2.md", headings: [{ title: "Start", line: 1 }] },
      ],
    });

    expect(new Set(options.map((option) => option.key)).size).toBe(2);
    expect(options.map((option) => option.planFile)).toEqual(["plan.md", "docs/phase-2.md"]);
  });
});

describe("validateNewTaskDraft", () => {
  test("poprawny szkic nie zwraca błędów", () => {
    expect(validateNewTaskDraft({ projectId: "workflow-core", title: "Nowe zadanie" })).toEqual({});
  });

  test("wymaga projektu", () => {
    expect(validateNewTaskDraft({ projectId: "   ", title: "Zadanie" })).toEqual({
      projectId: "Wybierz projekt.",
    });
  });

  test("wymaga niepustego tytułu (po przycięciu białych znaków)", () => {
    expect(validateNewTaskDraft({ projectId: "workflow-core", title: "   " })).toEqual({
      title: "Podaj tytuł zadania.",
    });
    expect(validateNewTaskDraft({ projectId: "workflow-core", title: "  Retry  " })).toEqual({});
  });

  test("ogranicza długość tytułu do 200 znaków", () => {
    const errors = validateNewTaskDraft({ projectId: "workflow-core", title: "x".repeat(201) });
    expect(errors.title).toBe("Tytuł może mieć maksymalnie 200 znaków.");
  });
});

describe("createTaskErrorMessage", () => {
  test("409 duplicate_title tłumaczy na komunikat o duplikacie", () => {
    const message = createTaskErrorMessage(new ApiError(409, "duplicate_title", "duplicate"));
    expect(message).toContain("już istnieje");
    expect(message).toContain("duplicate_title");
  });

  test("400 zwraca komunikat walidacji z kodem serwera", () => {
    const message = createTaskErrorMessage(new ApiError(400, "validation_error", "title"));
    expect(message).toContain("validation_error");
    expect(message).toContain("Sprawdź tytuł");
  });

  test("błąd sieci zachowuje polski komunikat klienta", () => {
    const message = createTaskErrorMessage(new ApiError(0, "network_error", "Brak połączenia z serwerem."));
    expect(message).toBe("Brak połączenia z serwerem.");
  });

  test("nieznany błąd nie ujawnia szczegółów technicznych", () => {
    expect(createTaskErrorMessage(new Error("boom"))).toBe(
      "Nie udało się odczytać odpowiedzi serwera. Spróbuj ponownie.",
    );
  });
});
