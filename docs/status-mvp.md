# V3rne — stan MVP

Dokument opisuje, co jest gotowe, jakie są odstępstwa od specyfikacji i co pozostaje poza MVP.

## Jak uruchomić

```bash
bun install
bun run seed            # opcjonalnie: demo-workspace/ + data/ z przykładowymi danymi
bun run build:web
bun run dev             # http://127.0.0.1:4321
```

Tryb developerski UI: `bun run dev:web` (Vite na :5173, proxy na :4321).

Docker: `docker compose up --build` po ustawieniu `WORKSPACE_PATH` w `.env`.

## Zaimplementowane

### Fundament
- Monorepo Bun (`shared`, `server`, `web`), TypeScript strict.
- SQLite w trybie WAL z migracjami; schemat zgodny ze specyfikacją (tabele `projects`, `tasks`, `comments`, `attachments`, `task_events`, indeksy). Migracja 002 dodaje unikalność `lower(rel_path)`.
- Loader `config.yaml` z walidacją Zod; ścieżka configu niezależna od katalogu uruchomienia (`<repo>/data/config.yaml`, `DATA_DIR` ma priorytet).
- Workspace ma jedno źródło: `WORKSPACE_PATH` w `.env` (czytany przez Bun i docker compose). `workspace_root` w `config.yaml` to tylko zgodnościowy fallback.
- Dockerfile (Bun + git, `safe.directory '*'`) i `docker-compose.yml` z montowaniem workspace `:ro`.

### Git i plan
- Poller Gita co `git_poll_interval_sec` (domyślnie 300 s), zawsze `--no-optional-locks`; pierwsze odświeżenie przy starcie.
- Snapshot: gałąź, dirty, worktrees, ahead/behind, 40 commitów z kodem zadania, gałęzie lokalne, zmienione pliki (limit 500), ostatnio ruszane pliki (limit 200). Treść plików poza `.md` nie jest czytana.
- Parser nagłówków `plan.md` (poziomy 1–3, slugi, pomijanie bloków kodu).
- Hash SHA-256 z normalizacją CRLF→LF i detekcja dryfu z ręcznym zatwierdzeniem (`ack-drift`).
- Źródła planu: jawne `plan_files` oraz rekurencyjny skan `*.md` w `defaults.plan_dirs` (`context`, `docs`; głębokość 3, limit 200 plików). `plan_dir_exclude` (`archive`, `node_modules`, `.git`) pomija katalogi na każdym poziomie; symlinki nie są śledzone. Katalogi można nadpisać per projekt (`planDirs`, `NULL` = wartość z configu).
- `ack-drift` zapisuje hashe wszystkich rozwiązanymi plików (także tych z katalogów), a zmiana `plan_files`/`plan_dirs` usuwa hashe plików, które wypadły z planu.
- Auto-discovery repozytoriów do `scan_depth`.

### REST API (`/api/v1`)
- Projekty: lista (z policzonym `git`), tworzenie, edycja (w tym `relPath` i `planDirs`), odświeżenie Gita, plan (źródła jawne + katalogi, pola `origin` i `truncated`), docs, ack-drift, discovery.
- Zadania: lista z filtrami, tworzenie, bulk (max 100, odrzucanie duplikatów tytułu w projekcie i sekcji), szczegóły, edycja, usuwanie (z plikami załączników), komentarze, rozwiązywanie wątpliwości, inbox, statystyki.
- Załączniki: upload do `max_attachment_bytes` na plik (domyślnie 10 MB), pobieranie z `Content-Disposition: attachment` i `nosniff`, usuwanie.
- Błędy w formacie `{error:{code,message}}`; kolekcje zwracane jako obiekty z kluczem.

### MCP (`/mcp`, Streamable HTTP)
- Dziesięć narzędzi: `list_projects`, `get_project_context`, `list_tasks`, `get_next_task`, `get_task`, `list_doubts`, `create_tasks`, `update_task`, `add_entry`, `get_attachment`. Kontrakt: [README_AI.md](/Users/tomaszwawrzyniak/Projects/v3rne/agent-board/README_AI.md).
- Atomowe claimowanie w `BEGIN IMMEDIATE`, idempotencja po `agent_name`, rozpoznawanie projektu po `cwd`.
- Limit załącznika z `mcp_attachment_max_bytes` (domyślnie 5 MB).

### UI (React + Vite + Tailwind)
- Layout jak w mockupie: sidebar z repozytoriami i licznikiem wątpliwości, topbar, toasty.
- Radar: KPI, karty projektów z telemetrią Gita, postępem i alertem dryfu.
- Widok projektu: plan z filtrem sekcji i ack-drift, Agent Docs, kopiowanie promptu rozbicia sekcji, lista priorytetów i Kanban (4 kolumny, przeciąganie kart zmienia status i kolejność), wyszukiwarka i filtry zadań, drawer zadania (status, priorytet, komentarze, wątpliwości, commity, załączniki z podglądem, drag-and-drop, Ctrl+V, usuwaniem i historią zdarzeń).
- Modal „Nowe zadanie”: wybór projektu, priorytetu i sekcji planu, walidacja, zapis do `ready`.
- Inbox wątpliwości z odpowiedzią i odblokowaniem.
- Statystyki: velocity, średni czas odpowiedzi, rozkład statusów, zdarzenia.
- Konfigurator: lista projektów z przełącznikiem aktywności, skaner z rejestracją nowych repozytoriów, adres MCP, podgląd configu.
- Maskotka: trzy naklejki (HELLO!, SPRINT!, ZzZ...) z manifestem w `packages/web/public/mascot`.

## Odstępstwa i decyzje

- Konfiguracja projektów jest w SQLite; `config.yaml` zawiera wyłącznie ustawienia portalu (rozstrzygnięcie sprzecznej sekcji 3 specyfikacji).
- Kanban ma 4 kolumny; `backlog` i `cancelled` są widoczne w liście i filtrach.
- MCP działa bezstanowo: `GET /mcp` zwraca 405, brak powiadomień SSE.
- Limit załącznika w REST i MCP jest osobny (`max_attachment_bytes` vs `mcp_attachment_max_bytes`).
- Radar liczy „otwarte wątpliwości” jako zadania `needs_input`, bez dodatkowego zapytania o komentarze.
- Postęp pomija zadania `cancelled` w mianowniku.
- Normalizacja `rel_path`: trim, `/`, bez końcowego ukośnika; unikalność bez względu na wielkość liter.
- Pliki planu o tej samej nazwie różniącej się wielkością liter (`plan.md` / `PLAN.md`) są czytane raz — istotne na macOS i Windows.
- Deduplikacja tytułów obowiązuje w `create_tasks` (MCP) i `tasks/bulk` (REST). Pojedyncze `POST /projects/:id/tasks` z UI człowieka dopuszcza ten sam tytuł — świadomie, żeby ręczne tworzenie nie było blokowane przez wcześniejsze zadanie.

## Poza MVP

- Micro-CLI `board` (świadomie odłożone; MCP wystarcza).
- Edycja globalnych wartości domyślnych (`defaults.*`) z UI — tylko w `config.yaml`; per projekt edycja jest w konfiguratorze.
- Podgląd załączników SVG inline (świadomie wyłączony ze względu na XSS; SVG jest tylko do pobrania).
- Edycja limitów załączników z UI (limit jest w `config.yaml`, a komunikat 413 pokazuje wartość serwera).
- Uwierzytelnianie endpointów (portal działa lokalnie na loopbacku).
- Paginacja list i limit inboxu.
- Filtr „tylko z gałęzią” (dziś filtr „tylko przypisane” sprawdza agenta, nie gałąź).
- Równoległe odpytywanie projektów (przy kilku projektach czas pollera jest pomijalny).
