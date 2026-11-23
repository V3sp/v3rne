# @v3rne/web

Frontend portalu: React + Vite + Tailwind CSS v4. Aktualnie zawiera layout (sidebar, topbar) oraz widok Radaru Projektów.

## Skrypty

- `bun run dev` — serwer Vite z proxy `/api` i `/mcp` na `http://127.0.0.1:4321` (uruchom wcześniej serwer).
- `bun run build` — sprawdzenie typów i build produkcyjny do `dist/`.
- `bun run typecheck` — samo `tsc --noEmit`.
- `bun test` — testy funkcji czystych i klienta API.

## Struktura

- `src/api/` — klient REST (`/api/v1`) i typy odpowiedzi.
- `src/lib/` — mapowanie statusów i priorytetów, formatowanie postępu i czasu, KPI Radaru.
- `src/components/` — layout, widok Radaru, karty projektów, maskotka, stany ładowania i błędu.
- `src/hooks/` — ładowanie danych Radaru.
- `public/mascot/` — naklejki maskotki (`hello.png` używany w pustym Radarze; brak pliku daje tekstowy fallback).
