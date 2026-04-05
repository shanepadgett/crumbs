import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createReadTool } from "@mariozechner/pi-coding-agent";

function normalizePathArgument(path: string): string {
  return path.replace(/^@/, "").trim();
}

export async function loadImageFile(
  cwd: string,
  rawPath: string,
  options?: { preserveOriginal?: boolean; signal?: AbortSignal },
): Promise<{
  path: string;
  data: string;
  mimeType: string;
  detail: "original" | null;
}> {
  const inputPath = normalizePathArgument(rawPath);
  if (!inputPath) throw new Error("Path must not be empty.");

  const absolutePath = isAbsolute(inputPath) ? resolve(inputPath) : resolve(cwd, inputPath);
  const canonicalPath = await realpath(absolutePath).catch(() => {
    throw new Error(`Path does not exist: ${rawPath}`);
  });

  const info = await stat(canonicalPath);
  if (!info.isFile()) {
    throw new Error(`Expected an image file: ${rawPath}`);
  }

  const readTool = createReadTool(cwd, {
    autoResizeImages: options?.preserveOriginal !== true,
  });
  const result = await readTool.execute("view_image", { path: canonicalPath }, options?.signal);

  const image = result.content.find((block) => block.type === "image");
  if (!image || image.type !== "image") {
    throw new Error(`Not a supported image file: ${rawPath}`);
  }

  return {
    path: canonicalPath,
    data: image.data,
    mimeType: image.mimeType,
    detail: options?.preserveOriginal ? "original" : null,
  };
}
