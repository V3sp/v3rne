import type { Attachment } from "@v3rne/shared";
import { API_BASE, ApiError } from "./client";

const NETWORK_ERROR_MESSAGE =
  "Brak połączenia z serwerem V3rne. Sprawdź, czy usługa działa na porcie 4321.";

/** Clipboard screenshots occasionally arrive without a name; the server rejects empty filenames. */
const FALLBACK_FILENAME = "wklejony-plik";

export function attachmentFilename(file: File): string {
  const name = file.name.trim();
  return name.length > 0 ? name : FALLBACK_FILENAME;
}

/** The server reads a single file from the `file` field. */
export function buildAttachmentFormData(file: File): FormData {
  const form = new FormData();
  form.append("file", file, attachmentFilename(file));
  return form;
}

/**
 * Multipart upload must not go through `apiRequest`: it sets a JSON `Content-Type`,
 * which would strip the multipart boundary. The response is the created attachment.
 */
export async function uploadTaskAttachment(code: string, file: File): Promise<Attachment> {
  const response = await attachmentFetch(`/tasks/${encodeURIComponent(code)}/attachments`, {
    method: "POST",
    body: buildAttachmentFormData(file),
    headers: { Accept: "application/json" },
  });
  return (await response.json()) as Attachment;
}

/** The server answers 204 with no body, so the response is deliberately not parsed. */
export async function deleteAttachment(attachmentId: number): Promise<void> {
  await attachmentFetch(`/attachments/${attachmentId}`, {
    method: "DELETE",
    headers: { Accept: "application/json" },
  });
}

async function attachmentFetch(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) throw await toAttachmentError(response);
  return response;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

async function toAttachmentError(response: Response): Promise<ApiError> {
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
