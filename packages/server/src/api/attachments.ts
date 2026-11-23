import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import type { Attachment } from "@v3rne/shared";
import {
  ApiError,
  formatZodError,
  jsonError,
  mapAttachment,
  nowIso,
  toErrorResponse,
  type ApiDeps,
  type AttachmentRow,
  type TaskRow,
} from "./tasks";

/**
 * Multipart framing (boundaries, part headers) is not part of the file, so a
 * `Content-Length` pre-check has to allow for it. Anything below
 * `max + allowance` is still rejected after the file is measured.
 */
const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 1024 * 1024;
const MAX_FILENAME_LENGTH = 120;
const DEFAULT_MIME_TYPE = "application/octet-stream";

const CommentIdSchema = z.coerce.number().int().positive();

export function createAttachmentsRouter(deps: ApiDeps): Hono {
  const { db, config } = deps;
  const dataDir = path.resolve(deps.dataDir ?? process.env.DATA_DIR ?? "./data");
  const maxBytes = config.max_attachment_bytes;
  const app = new Hono();

  app.post("/tasks/:code/attachments", async (c) => {
    try {
      const code = c.req.param("code");
      const task = db.query<TaskRow, [string]>("SELECT * FROM tasks WHERE code = ?").get(code);
      if (!task) throw new ApiError(404, "task_not_found", `Task "${code}" was not found`);

      const contentLength = Number(c.req.header("content-length"));
      if (
        Number.isFinite(contentLength) &&
        contentLength > 0 &&
        contentLength > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE_BYTES
      ) {
        throw new ApiError(
          413,
          "file_too_large",
          `Attachment exceeds the ${maxBytes} byte limit`,
        );
      }

      let form: FormData;
      try {
        form = await c.req.formData();
      } catch {
        throw new ApiError(400, "invalid_multipart", "Request body must be multipart/form-data");
      }

      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new ApiError(400, "file_required", "A single file must be sent in the 'file' field");
      }
      if (file.size > maxBytes) {
        throw new ApiError(413, "file_too_large", `Attachment exceeds the ${maxBytes} byte limit`);
      }

      const rawCommentId = form.get("commentId");
      let commentId: number | null = null;
      if (typeof rawCommentId === "string" && rawCommentId.trim().length > 0) {
        const parsed = CommentIdSchema.safeParse(rawCommentId);
        if (!parsed.success) {
          return jsonError(c, 400, "validation_error", formatZodError(parsed.error));
        }
        const comment = db
          .query<{ id: number; task_id: number }, [number]>("SELECT id, task_id FROM comments WHERE id = ?")
          .get(parsed.data);
        if (!comment || comment.task_id !== task.id) {
          throw new ApiError(404, "comment_not_found", `Comment ${parsed.data} does not belong to task ${code}`);
        }
        commentId = comment.id;
      }

      const safeName = sanitizeFilename(file.name);
      if (!safeName) {
        throw new ApiError(400, "invalid_filename", "Attachment filename is empty after sanitization");
      }

      const directory = path.resolve(dataDir, "uploads", task.project_id, task.code);
      if (!isInside(dataDir, directory)) {
        throw new ApiError(400, "invalid_path", "Attachment storage path escapes the data directory");
      }
      await mkdir(directory, { recursive: true });

      const storagePath = path.join(directory, `${randomUUID()}-${safeName}`);
      await Bun.write(storagePath, file);

      const now = nowIso();
      const result = db.run(
        `INSERT INTO attachments (task_id, comment_id, filename, mime_type, storage_path, size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          task.id,
          commentId,
          safeName,
          file.type.length > 0 ? file.type : DEFAULT_MIME_TYPE,
          storagePath,
          file.size,
          now,
        ],
      );

      const attachment: Attachment = {
        id: Number(result.lastInsertRowid),
        taskId: task.id,
        commentId,
        filename: safeName,
        mimeType: file.type.length > 0 ? file.type : DEFAULT_MIME_TYPE,
        storagePath,
        sizeBytes: file.size,
        createdAt: now,
      };
      return c.json(attachment, 201);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.get("/attachments/:id/raw", async (c) => {
    try {
      const row = findAttachment(db, c.req.param("id"));
      const file = Bun.file(row.storage_path);
      if (!(await file.exists())) {
        throw new ApiError(404, "file_missing", `Stored file for attachment ${row.id} is missing`);
      }

      return new Response(file, {
        headers: {
          "Content-Type": row.mime_type,
          "Content-Disposition": contentDisposition(row.filename),
          "Content-Length": String(row.size_bytes),
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  app.delete("/attachments/:id", async (c) => {
    try {
      const row = findAttachment(db, c.req.param("id"));
      await unlink(row.storage_path).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
      db.run("DELETE FROM attachments WHERE id = ?", [row.id]);
      return c.body(null, 204);
    } catch (err) {
      return toErrorResponse(c, err);
    }
  });

  return app;
}

function findAttachment(db: ApiDeps["db"], rawId: string): AttachmentRow {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "validation_error", "attachment id must be a positive integer");
  }
  const row = db.query<AttachmentRow, [number]>("SELECT * FROM attachments WHERE id = ?").get(id);
  if (!row) throw new ApiError(404, "attachment_not_found", `Attachment ${id} was not found`);
  return row;
}

/** Keeps the last path segment only, replaces everything outside `[A-Za-z0-9._-]`. */
export function sanitizeFilename(rawName: string): string | null {
  const base = rawName.split(/[\\/]/).pop() ?? "";
  if (base.trim().length === 0) return null;
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}
