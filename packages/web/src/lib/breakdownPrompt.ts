export interface BreakdownPromptInput {
  projectId: string;
  projectName: string;
  planPath: string;
  sectionTitle: string;
  level: 1 | 2 | 3;
}

/**
 * Prompt for an external agent that splits one plan section into board tasks via MCP.
 * The section title is embedded as a JSON string so quotes and backslashes survive copy-paste intact.
 */
export function buildBreakdownPrompt({
  projectId,
  projectName,
  planPath,
  sectionTitle,
  level,
}: BreakdownPromptInput): string {
  const titleLiteral = JSON.stringify(sectionTitle);
  return [
    `Rozbij sekcję planu projektu „${projectName}” na niezależne zadania w Agent Board.`,
    "",
    "Dane projektu:",
    `- nazwa projektu: ${projectName}`,
    `- id projektu (project_id): ${projectId}`,
    `- plik planu: ${planPath}`,
    `- sekcja: ${sectionTitle}`,
    `- poziom nagłówka: ${level} (H${level})`,
    "",
    "Kroki:",
    `1. Przeczytaj sekcję w pliku ${planPath}: od nagłówka ${titleLiteral} do następnego nagłówka tego samego lub wyższego poziomu.`,
    "2. Rozbij ją na niezależne zadania i utwórz je jednym wywołaniem MCP create_tasks:",
    `   - project_id: "${projectId}"`,
    `   - plan_file: "${planPath}"`,
    `   - plan_section: ${titleLiteral} (dokładny tytuł nagłówka, bez zmian)`,
    "   - priority: low, medium, high albo urgent, zależnie od wagi zadania",
    '   - status: "ready" dla zadań gotowych do podjęcia, "backlog" dla zadań czekających na decyzję',
    "3. Nie twórz duplikatów: najpierw sprawdź istniejące zadania projektu (list_tasks) i pomiń te, które już istnieją, nawet pod inną nazwą. create_tasks odrzuca całą partię, jeśli któryś tytuł się powtarza.",
    "4. Przy wątpliwościach nie zgaduj. Po utworzeniu zadania, którego dotyczy wątpliwość, dodaj wpis add_entry z kind=\"doubt\" i opisem pytania.",
    "5. Na koniec podaj krótki raport: ile zadań utworzono, ich kody i co zostało wstrzymane wątpliwością.",
  ].join("\n");
}
