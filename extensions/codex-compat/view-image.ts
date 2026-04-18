import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createReadTool, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCodexCompatCapabilities } from "./src/capabilities.js";

const VIEW_IMAGE_PARAMS = Type.Object({
  path: Type.String({ description: "Path to a local image file" }),
  detail: Type.Optional(
    Type.Literal("original", {
      description: "Request original image detail when the model supports it",
    }),
  ),
});

function normalizePathArgument(path: string): string {
  return path.replace(/^@/, "").trim();
}

async function loadImageFile(
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

export default function codexCompatViewImageExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "view_image",
    label: "View Image",
    description:
      "Load a local image file and return it as an image tool result for visual inspection.",
    promptSnippet: "Attach a local image file for inspection",
    promptGuidelines: [
      "Use view_image when you need to inspect a local screenshot, diagram, or other image asset.",
      'Pass detail: "original" only when the current compat model supports it.',
    ],
    parameters: VIEW_IMAGE_PARAMS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const capability = getCodexCompatCapabilities(ctx.model);
      if (!capability?.supportsImageInput) {
        throw new Error("view_image is not available for current model.");
      }
      if (params.detail === "original" && !capability.supportsOriginalImageDetail) {
        throw new Error('detail: "original" is not supported for current model.');
      }

      const image = await loadImageFile(ctx.cwd, params.path, {
        preserveOriginal: params.detail === "original",
        signal,
      });

      return {
        content: [{ type: "image", data: image.data, mimeType: image.mimeType }],
        details: {
          path: image.path,
          mimeType: image.mimeType,
          detail: image.detail,
        },
      };
    },
  });
}
