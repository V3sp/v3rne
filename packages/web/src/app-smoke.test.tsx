/**
 * Test dymny renderowania: sprawdza, że całe drzewo aplikacji renderuje się
 * bez błędów runtime, zanim ktokolwiek otworzy je w przeglądarce.
 *
 * Uruchomienie: bun test src/app-smoke.test.tsx (w katalogu packages/web)
 */
import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { App } from "./App";
import { ToastProvider } from "./components/Toasts";

const emptyResponse = () => new Response(JSON.stringify({ projects: [] }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

describe("App – render dymny", () => {
  test("renderuje szkielet bez wyjątku", () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => emptyResponse()) as unknown as typeof fetch;

    try {
      const html = renderToString(
        <ToastProvider>
          <App />
        </ToastProvider>,
      );
      expect(html).toContain("V3rne");
      expect(html).toContain("Radar");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
