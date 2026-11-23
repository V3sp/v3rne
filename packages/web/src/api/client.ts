export const API_BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "network_error",
      "Brak połączenia z serwerem V3rne. Sprawdź, czy usługa działa na porcie 4321.",
    );
  }

  if (!response.ok) throw await toApiError(response);

  // The server contract is enforced by the shared types, not at runtime.
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody | null = null;
  try {
    body = (await response.json()) as ErrorBody | null;
  } catch {
    body = null;
  }

  const code = typeof body?.error?.code === "string" ? body.error.code : "http_error";
  const message =
    typeof body?.error?.message === "string"
      ? body.error.message
      : `Serwer zwrócił błąd HTTP ${response.status}.`;
  return new ApiError(response.status, code, message);
}

/** User-facing message; never exposes stack traces or raw parser errors. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Nie udało się odczytać odpowiedzi serwera. Spróbuj ponownie.";
}
