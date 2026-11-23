import { afterEach, describe, expect, test } from "bun:test";
import { ApiError, apiRequest, describeError } from "./client";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("apiRequest", () => {
  test("returns parsed JSON from /api/v1", async () => {
    mockFetch((url) => {
      expect(url).toBe("/api/v1/projects");
      return Response.json({ projects: [] });
    });
    await expect(apiRequest<{ projects: unknown[] }>("/projects")).resolves.toEqual({
      projects: [],
    });
  });

  test("maps the {error:{code,message}} envelope to ApiError", async () => {
    mockFetch(() =>
      Response.json(
        { error: { code: "not_found", message: "Project not found: nope" } },
        { status: 404 },
      ),
    );

    const error = await apiRequest("/projects/nope").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "Project not found: nope" });
    expect(describeError(error)).toBe("Project not found: nope");
  });

  test("falls back to an HTTP message when the body is not the error envelope", async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));

    const error = await apiRequest("/projects").catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 502, code: "http_error" });
    expect(describeError(error)).toBe("Serwer zwrócił błąd HTTP 502.");
  });

  test("network failure becomes a readable ApiError without raw fetch text", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });

    const error = await apiRequest("/projects").catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(describeError(error)).not.toContain("Failed to fetch");
  });
});

describe("describeError", () => {
  test("hides non-API errors behind a generic message", () => {
    expect(describeError(new Error("Unexpected token < in JSON"))).toBe(
      "Nie udało się odczytać odpowiedzi serwera. Spróbuj ponownie.",
    );
  });
});
