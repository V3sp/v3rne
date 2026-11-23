# Agent Board — wsad do zewnętrznej analizy architektury

Cel: zewnętrzny agent ma zweryfikować krytyczne decyzje przed implementacją MVP.
Źródła: `agent_board_specyfikacja_projektu.md`, `agent_board_interaktywny_mock_portalu.html` (w katalogu nadrzędnym `v3rne/`).

## Ustalenia z właścicielem projektu

- Docker jako środowisko startowe; działanie lokalne na macOS i Linuxie.
- Dostęp tylko lokalny (domyślnie bind na loopback `127.0.0.1:4321`).
- `config.yaml` — ustawienia portalu (workspace, interwał pollera, limit uploadu).
- Konfiguracja monitorowanych projektów — w SQLite.
- Tablica zadań oparta na podstawowym Kanbanie.
- Załączniki: brak ograniczenia rozszerzeń; limit 10 MB na pojedynczy plik, konfigurowalny w `config.yaml`.
- Micro-CLI `board` poza MVP; MCP w MVP.
- Zakres zamknięty na dwa dostarczone pliki.

## Decyzje do oceny

### D1. Atomowe `get_next_task(claim=true)`
Propozycja: transakcja SQLite `BEGIN IMMEDIATE`; jeśli agent ma już `in_progress`, zwrócić to zadanie (idempotencja przy ponowieniu); w przeciwnym razie wybrać najwyższy priorytet `ready` (`urgent > high > medium > low`, potem `sort_order`), przypisać `claimed_by`, ustawić `in_progress`, zapisać `task_events`, zatwierdzić.
Pytania: czy wystarczy `BEGIN IMMEDIATE` przy współbieżnych żądaniach MCP i REST; czy idempotencja po `agent_name` nie pozwoli jednemu agentowi zablokować kilku zadań; co z zadaniem zawieszonym po awarii agenta (brak lease/heartbeat w MVP — czy to akceptowalne?).

### D2. Maszyna stanów i Kanban
Statusy: `backlog`, `ready`, `in_progress`, `needs_input`, `done`, `cancelled`.
Pytania: dozwolone ręczne przejścia z UI (np. `done → ready`, `cancelled → ready`); czy `doubt` z `in_progress` zawsze przechodzi do `needs_input`; co się dzieje, gdy rozwiązanie wątpliwości następuje po tym, jak agent już dodał kolejną wątpliwość; czy `backlog` może być pobrany przez agenta.
Niespójność: mockup pokazuje Kanban bez kolumny `Backlog` i bez `cancelled` — do rozstrzygnięcia, czy kolumny mają być pełne.

### D3. Źródło prawdy konfiguracji (KRYTYCZNE — sprzeczność)
Specyfikacja (sekcja 3) mówi, że konfiguracja projektów jest w `config.yaml` z zapisem zwrotnym z UI do pliku i synchronizacją do SQLite.
Decyzja właściciela: konfiguracja projektów w SQLite, `config.yaml` tylko dla ustawień portalu.
Do oceny: strategia wersjonowania/migracji `config.yaml`; czy `config.yaml` ma być tylko do odczytu przy starcie; jak obsłużyć ręczną edycję pliku.

### D4. Telemetria Gita (`:ro`)
Każde polecenie z `--no-optional-locks`; mount `WORKSPACE_PATH:WORKSPACE_PATH:ro`; `safe.directory '*'`.
Pytania: czy `git worktree list` i `log` działają poprawnie na `:ro` bez `index.lock`; jak wykrywać zmiany `dirty` bez zapisu do repo (`status --porcelain` z `--no-optional-locks` powinno wystarczyć — zweryfikować); czy poller na dużych repo nie będzie zbyt kosztowny; jak mapować commity `[CODE-XX]` do zadań, gdy kod zadania jest w różnych projektach.

### D5. Dryf `plan.md`
Hash SHA-256 zapisany w `projects.plan_hashes_json`; wskaźnik dryfu aż do ręcznego `ack-drift`.
Pytania: czy hash liczyć po normalizacji końców linii; czy zmiana w `docs/phase-2.md` także generuje dryf; co z planami, które zniknęły z dysku.

### D6. Załączniki
Limit 10 MB na plik, dowolne MIME, zapis w `/app/data/uploads/<project>/<code>/<uuid>-<name>`.
Pytania: walidacja nazwy pliku (path traversal); odpowiedź `GET /attachments/:id/raw` — `Content-Disposition: attachment` i `X-Content-Type-Options: nosniff` dla nieznanych typów; czy `image/svg+xml` z uploadu może być renderowany w portalu (ryzyko XSS — proponuję nie renderować SVG inline); czy 10 MB jest sprawdzane przed zapisem na dysk (streaming).

### D7. Kontrakt MCP
8 narzędzi: `list_projects`, `get_project_context`, `list_tasks`, `get_next_task`, `create_tasks`, `update_task`, `add_entry`, `get_attachment`.
Pytania: czy `get_project_context` i `list_projects` nie dublują danych; czy `create_tasks` ma kontrolować duplikaty (ten sam tytuł w tej samej sekcji); jak zwracać błędy w formacie MCP; czy `get_attachment` z dużym plikiem nie przekroczy limitów odpowiedzi MCP.

### D8. Niespójności do wyjaśnienia
- Mockup używa `plan_section` jako tytułu sekcji, specyfikacja mówi o slugu/kotwicy — wybrać jedno.
- Spec wymaga zapisu zmian konfiguracji do `config.yaml` (sprzeczne z D3).
- Mockup pokazuje atrybut `gitBranch` w zadaniu, ale spec nie definiuje, kto go ustawia.

## Oczekiwany wynik analizy
1. Lista decyzji zaakceptowanych / zmienionych z uzasadnieniem.
2. Rozstrzygnięcie D3 (źródło prawdy konfiguracji) i D2 (kolumny Kanbanu).
3. Poprawiony kontrakt MCP i REST, jeśli wymagany.
4. Lista ryzyk i testów krytycznych (szczególnie D1 i D6).
