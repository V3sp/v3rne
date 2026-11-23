import { describe, expect, test } from "bun:test";
import { codePrefixForName, slugifyRepoName } from "./config";

describe("slugifyRepoName", () => {
  test("zamienia spacje i wielkie litery", () => {
    expect(slugifyRepoName("Workflow Core")).toBe("workflow-core");
    expect(slugifyRepoName("Moje Repo 2")).toBe("moje-repo-2");
  });

  test("usuwa znaki spoza a-z0-9", () => {
    expect(slugifyRepoName("api_v2 (prod)")).toBe("api-v2-prod");
    expect(slugifyRepoName("--div---")).toBe("div");
  });

  test("radzi sobie z polskimi znakami i pustą nazwą", () => {
    expect(slugifyRepoName("Projekt Łódź")).toBe("projekt-lodz");
    expect(slugifyRepoName("###")).toBe("repo");
  });
});

describe("codePrefixForName", () => {
  test("bierze inicjały słów", () => {
    expect(codePrefixForName("workflow-core")).toBe("WC");
    expect(codePrefixForName("Mobile Client Swift")).toBe("MCS");
  });

  test("pojedyncze słowo skraca do liter", () => {
    expect(codePrefixForName("transit")).toBe("TRANS");
    expect(codePrefixForName("api")).toBe("API");
  });

  test("zapewnia minimum dwóch znaków", () => {
    expect(codePrefixForName("7")).toBe("XX");
  });
});
