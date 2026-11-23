import { describe, expect, test } from "bun:test";
import { attachmentFilename, buildAttachmentFormData } from "./attachments";

function makeFile(contents: string, name: string, type: string): File {
  return new File([contents], name, { type });
}

describe("attachment upload payload", () => {
  test("keeps the original filename", () => {
    const file = makeFile("hello", "notatka.txt", "text/plain");
    expect(attachmentFilename(file)).toBe("notatka.txt");
    expect((buildAttachmentFormData(file).get("file") as File).name).toBe("notatka.txt");
  });

  test("sends the file in the single 'file' field the server expects", () => {
    const file = makeFile("png-bytes", "screen.png", "image/png");
    const form = buildAttachmentFormData(file);

    expect(form.get("file")).toBeInstanceOf(File);
    expect((form.get("file") as File).type).toBe("image/png");
    expect((form.get("file") as File).size).toBe(file.size);
    expect(form.get("commentId")).toBeNull();
    expect(Array.from(form.keys())).toEqual(["file"]);
  });

  test("gives clipboard screenshots without a name a fallback filename", () => {
    const file = makeFile("raw", "", "image/png");
    expect(attachmentFilename(file)).toBe("wklejony-plik");
    expect((buildAttachmentFormData(file).get("file") as File).name).toBe("wklejony-plik");
  });

  test("trims a whitespace-only name before upload", () => {
    const file = makeFile("raw", "   ", "image/png");
    expect(attachmentFilename(file)).toBe("wklejony-plik");
  });
});
