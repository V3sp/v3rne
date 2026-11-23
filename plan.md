# V3rne — plan rozwoju

Lokalny portal do monitorowania projektów prowadzonych z agentami AI. Ten plik jest źródłem prawdy o zakresie i kolejności prac; zadania w portalu wskazują jego sekcje, a postęp liczy się z tablicy.

## 1. Fundament

Cel: jedno uruchomienie (Bun lub Docker) i trwały stan bez zewnętrznych usług.

- [x] Monorepo Bun: `packages/shared`, `packages/server`, `packages/web`
- [x] SQLite WAL z migracjami i schematem projektów, zadań, komentarzy, załączników i zdarzeń
- [x] `config.yaml` walidowany Zod; workspace wyłącznie z `WORKSPACE_PATH` w `.env`
- [x] Dockerfile (Bun + git) i compose z montowaniem repozytoriów `:ro`
- [x] README, README_AI i dane demo (`bun run seed`)

Kryterium wyjścia: `bun run dev` i `docker compose up` dają ten sam, działający portal.

## 2. API i model danych

Cel: pełny kontrakt REST, na którym stoją UI i agenci.

- [x] Projekty: CRUD, plan i dryf, docs, auto-discovery, walidacja `relPath`
- [x] Zadania: kod `PREFIX-N`, bulk, filtry, historia zdarzeń, miękkie przejścia statusów
- [x] Wątpliwości: `doubt → needs_input`, rozwiązanie przełącza zadanie na `ready`
- [x] Załączniki: limit na plik, pobieranie jako attachment, czyszczenie przy usuwaniu zadania
- [x] Statystyki: velocity, czas odpowiedzi na wątpliwości, rozkład statusów
- [x] Spójne błędy `{error:{code,message}}` i kolekcje jako obiekty z kluczem

Kryterium wyjścia: każdy widok UI da się odtworzyć wyłącznie przez REST.

## 3. Agenci (MCP)

Cel: agent pobiera pracę, raportuje postęp i nie zgaduje.

- [x] Streamable HTTP pod `/mcp`, transport bezstanowy
- [x] Dziesięć narzędzi, w tym `get_next_task`, `get_task`, `list_doubts`, `get_attachment`
- [x] Atomowe claimowanie (`BEGIN IMMEDIATE`) i idempotencja po `agent_name`
- [x] Rozpoznawanie projektu po `cwd`
- [x] Odrzucanie duplikatów tytułów w projekcie

Kryterium wyjścia: obieg zadania w OpenCode od `get_next_task` do `done`, bez ręcznego kopiowania danych.

## 4. Portal (UI)

Cel: codzienna praca bez zaglądania do bazy i terminala.

- [x] Radar z telemetrią Gita, postępem i alertem dryfu
- [x] Widok projektu: plan, Agent Docs, lista priorytetów, Kanban z przeciąganiem
- [x] Wyszukiwarka i filtry zadań
- [x] Drawer zadania: komentarze, wątpliwości, commity, załączniki, historia
- [x] Podgląd planu z formatowaniem Markdown i treścią sekcji
- [x] Inbox wątpliwości i statystyki
- [x] Konfigurator: aktywność projektów, skaner, edycja projektu, adres MCP
- [x] Maskotka i identyfikacja V3rne
- [ ] Panel „ostatnio ruszane pliki” w widoku projektu

Kryterium wyjścia: człowiek rozwiązuje wątpliwość i zamyka zadanie bez opuszczania portalu.

## 5. Jakość i odporność

Cel: portal nie kłamie, gdy Git zawodzi.

- [x] Poller z `--no-optional-locks`, interwał 5 minut, odświeżanie przy starcie
- [x] Snapshot: gałęzie, dirty, worktrees, ahead/behind, commity, zmienione i ruszane pliki
- [x] `stale` i `lastErrorAt` po nieudanym odczycie; czytelny błąd uszkodzonego repo
- [x] Detached HEAD i repo bez remote
- [x] Benchmark dużego repo i pollera (`bench-git.ts`)
- [x] Plan z `context/` i `docs/`, konfigurowalne katalogi per projekt
- [ ] Filtr zadań po gałęzi (dziś „przypisane” sprawdza tylko agenta)

Kryterium wyjścia: awaria pojedynczego repo nie psuje widoku pozostałych.

## 6. Wdrożenie i CI

Cel: powtarzalne wydania i historia zmian.

- [ ] Pipeline: `typecheck`, `bun test`, `test:web`, `build:web`, build obrazu
- [ ] Wersjonowanie obrazu i tagi wydań
- [ ] Instrukcja Podman/SELinux (`:ro,Z`) i pracy z worktrees

Kryterium wyjścia: push na gałąź uruchamia testy, a tag tworzy obraz.

## 7. Bezpieczeństwo i eksploatacja

Cel: świadome granice zaufania i odtwarzalne dane.

- [ ] Token dla `/api` i `/mcp` (nagłówek `Authorization`), wymagany przy bindzie poza loopback
- [ ] Kopia zapasowa `board.db` i czyszczenie osieroconych uploadów
- [ ] `/health` z wersją, stanem pollera i czasem ostatniej synchronizacji
- [ ] Paginacja list i limit inboxu

Kryterium wyjścia: wystawienie portalu w LAN nie wymaga kompromisu w bezpieczeństwie.

## 8. Analityka

Cel: decyzje na podstawie danych, nie wrażeń.

- [ ] Czas cyklu zadania, WIP i wiek wątpliwości
- [ ] Statystyki per agent (przejęcia, ukończenia, czas odpowiedzi)
- [ ] Eksport CSV/JSON

Kryterium wyjścia: tygodniowy przegląd projektu da się zrobić z jednego ekranu.

## Decyzje architektoniczne

- Konfiguracja projektów w SQLite; `config.yaml` opisuje wyłącznie portal.
- Workspace ma jedno źródło: `WORKSPACE_PATH` w `.env`; `workspace_root` w configu to fallback.
- Repozytoria są tylko do odczytu, a każde polecenie Gita działa z `--no-optional-locks`.
- Kanban ma cztery kolumny; `backlog` i `cancelled` są widoczne w liście i filtrach.
- Postęp pomija zadania `cancelled` w mianowniku.
- MCP jest bezstanowe: brak SSE i powiadomień push.
- Limity załączników są osobne dla REST (10 MB) i MCP (5 MB).

## Poza zakresem

- Micro-CLI `board` (MCP wystarcza).
- Edycja globalnych `defaults.*` z UI (tylko `config.yaml`).
- Podgląd SVG inline (bezpieczeństwo; plik tylko do pobrania).
- Uwierzytelnianie wieloużytkownikowe i role.
