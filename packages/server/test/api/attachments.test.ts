import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Attachment } from "@v3rne/shared";
import {
  API_PREFIX,
  countRows,
  createTask,
  createTestApp,
  deleteJson,
  getJson,
  insertProject,
  postJson,
  type TestApp,
} from "./helpers";

const MAX_BYTES = 64;
const UUID_PREFIX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;

function upload(
  ctx: TestApp,
  code: string,
  content: string,
  filename: string,
  options: { type?: string; commentId?: number } = {},
) {
  const form = new FormData();
  form.set("file", new File([content], filename, { type: options.type ?? "application/octet-stream" }));
  if (options.commentId !== undefined) form.set("commentId", String(options.commentId));
  return ctx.app.request(`${API_PREFIX}/tasks/${code}/attachments`, {
    method: "POST",
    body: form,
  });
}

describe("attachments API", () => {
  let ctx: TestApp;

  beforeEach(() => {
    ctx = createTestApp({ config: { max_attachment_bytes: MAX_BYTES } });
    insertProject(ctx.db);
  });

  afterEach(() => {
    ctx.close();
  });

  test("uploads a file within the limit and stores it under DATA_DIR/uploads", async () => {
    const task = await createTask(ctx.app, { title: "With attachment" });
    const res = await upload(ctx, task.code, "hello board", "note.txt", { type: "text/plain" });

    expect(res.status).toBe(201);
    const attachment = (await res.json()) as Attachment;
    expect(attachment.taskId).toBe(task.id);
    expect(attachment.filename).toBe("note.txt");
    expect(attachment.mimeType).toContain("text/plain");
    expect(attachment.sizeBytes).toBe(11);
    expect(attachment.commentId).toBeNull();

    const expectedDir = path.join(ctx.dataDir, "uploads", "proj-a", task.code);
    expect(attachment.storagePath.startsWith(expectedDir)).toBe(true);
    expect(path.basename(attachment.storagePath)).toMatch(UUID_PREFIX);
    expect(existsSync(attachment.storagePath)).toBe(true);
    expect(await Bun.file(attachment.storagePath).text()).toBe("hello board");
  });

  test("rejects a file above max_attachment_bytes with 413", async () => {
    const task = await createTask(ctx.app, { title: "Too big" });
    const res = await upload(ctx, task.code, "x".repeat(MAX_BYTES + 1), "big.bin");

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("file_too_large");
    expect(countRows(ctx.db, "attachments")).toBe(0);

    const atLimit = await upload(ctx, task.code, "x".repeat(MAX_BYTES), "exact.bin");
    expect(atLimit.status).toBe(201);
  });

  test("rejects early when Content-Length already exceeds the limit", async () => {
    const task = await createTask(ctx.app, { title: "Declared big" });
    const body =
      '--b\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n' +
      "Content-Type: text/plain\r\n\r\nhi\r\n--b--\r\n";

    const res = await ctx.app.request(`${API_PREFIX}/tasks/${task.code}/attachments`, {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=b",
        "content-length": String(MAX_BYTES + 5 * 1024 * 1024),
      },
      body,
    });

    expect(res.status).toBe(413);
    expect(countRows(ctx.db, "attachments")).toBe(0);
  });

  test("requires the file field", async () => {
    const task = await createTask(ctx.app, { title: "No file" });
    const form = new FormData();
    form.set("commentId", "1");
    const res = await ctx.app.request(`${API_PREFIX}/tasks/${task.code}/attachments`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("file_required");
  });

  test("sanitizes traversal attempts in the filename", async () => {
    const task = await createTask(ctx.app, { title: "Traversal" });
    const res = await upload(ctx, task.code, "pwned", "../../etc/passwd evil?.txt", {
      type: "text/plain",
    });

    expect(res.status).toBe(201);
    const attachment = (await res.json()) as Attachment;
    expect(attachment.filename).toBe("passwd_evil_.txt");
    expect(attachment.filename).not.toContain("..");
    expect(attachment.filename).not.toContain("/");

    const defaultRoot = path.resolve(ctx.dataDir, "uploads");
    expect(path.resolve(attachment.storagePath).startsWith(defaultRoot)).toBe(true);
    expect(path.basename(attachment.storagePath)).toMatch(/-passwd_evil_\.txt$/);
  });

  test("falls back to application/octet-stream when the part has no type", async () => {
    const task = await createTask(ctx.app, { title: "Binary" });
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "blob.bin"));
    const res = await ctx.app.request(`${API_PREFIX}/tasks/${task.code}/attachments`, {
      method: "POST",
      body: form,
    });

    const attachment = (await res.json()) as Attachment;
    expect(attachment.mimeType).toBe("application/octet-stream");
  });

  test("serves raw content as an attachment with nosniff", async () => {
    const task = await createTask(ctx.app, { title: "Download" });
    const created = (await (await upload(ctx, task.code, "inline <script>", "page.html", {
      type: "text/html",
    })).json()) as Attachment;

    const res = await getJson(ctx.app, `/attachments/${created.id}/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(disposition).toContain('filename="page.html"');
    expect(await res.text()).toBe("inline <script>");
  });

  test("returns 404 for unknown attachments", async () => {
    expect((await getJson(ctx.app, "/attachments/42/raw")).status).toBe(404);
    expect((await deleteJson(ctx.app, "/attachments/42")).status).toBe(404);
    expect((await getJson(ctx.app, "/attachments/not-a-number/raw")).status).toBe(400);
  });

  test("links attachments to a comment of the same task", async () => {
    const task = await createTask(ctx.app, { title: "Commented" });
    const comment = (await (
      await postJson(ctx.app, `/tasks/${task.code}/comments`, {
        authorType: "human",
        authorName: "Ty",
        kind: "comment",
        body: "see screenshot",
      })
    ).json()) as { id: number };

    const res = await upload(ctx, task.code, "png-bytes", "shot.png", {
      type: "image/png",
      commentId: comment.id,
    });
    const attachment = (await res.json()) as Attachment;
    expect(attachment.commentId).toBe(comment.id);

    const other = await createTask(ctx.app, { title: "Other" });
    const otherComment = (await (
      await postJson(ctx.app, `/tasks/${other.code}/comments`, {
        authorType: "human",
        authorName: "Ty",
        kind: "comment",
        body: "elsewhere",
      })
    ).json()) as { id: number };

    const mismatch = await upload(ctx, task.code, "bytes", "shot.png", {
      commentId: otherComment.id,
    });
    expect(mismatch.status).toBe(404);
    expect(((await mismatch.json()) as { error: { code: string } }).error.code).toBe(
      "comment_not_found",
    );
  });

  test("deletes the row and the stored file", async () => {
    const task = await createTask(ctx.app, { title: "Remove" });
    const attachment = (await (await upload(ctx, task.code, "data", "remove.txt")).json()) as Attachment;
    expect(existsSync(attachment.storagePath)).toBe(true);

    const res = await deleteJson(ctx.app, `/attachments/${attachment.id}`);
    expect(res.status).toBe(204);
    expect(existsSync(attachment.storagePath)).toBe(false);
    expect(countRows(ctx.db, "attachments")).toBe(0);
    expect((await deleteJson(ctx.app, `/attachments/${attachment.id}`)).status).toBe(404);
  });

  test("unknown task returns 404", async () => {
    const res = await upload(ctx, "PRJ-999", "data", "x.txt");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("task_not_found");
  });
});
