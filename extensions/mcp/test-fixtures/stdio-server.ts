import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function readString(args: JsonObject, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function readNumber(args: JsonObject, key: string, fallback = 0): number {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    isError,
  };
}

const tools = [
  {
    name: "echo",
    description: "Return the provided message unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "add",
    description: "Add two numbers and return the sum.",
    inputSchema: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number." },
        b: { type: "number", description: "Second number." },
      },
      required: ["a", "b"],
      additionalProperties: false,
    },
  },
  {
    name: "object_keys",
    description: "Return sorted keys from an object argument.",
    inputSchema: {
      type: "object",
      properties: {
        value: {
          type: "object",
          description: "Object whose keys should be returned.",
          additionalProperties: true,
        },
      },
      required: ["value"],
      additionalProperties: false,
    },
  },
  {
    name: "big_output",
    description: "Return many text lines for truncation testing.",
    inputSchema: {
      type: "object",
      properties: {
        lines: {
          type: "number",
          description: "Line count to return. Defaults to 250.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "fail",
    description: "Return an MCP tool error for error-path testing.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Failure message." },
      },
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: "crumbs-mcp-stdio-fixture", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = asObject(request.params.arguments);

  switch (name) {
    case "echo":
      return textResult(readString(args, "message"));
    case "add":
      return textResult(String(readNumber(args, "a") + readNumber(args, "b")));
    case "object_keys": {
      const value = asObject(args.value);
      return textResult(
        Object.keys(value)
          .sort((a, b) => a.localeCompare(b))
          .join(","),
      );
    }
    case "big_output": {
      const requestedLines = Math.trunc(readNumber(args, "lines", 250));
      const lineCount = Math.max(1, Math.min(requestedLines, 5_000));
      const output = Array.from({ length: lineCount }, (_, index) => `fixture line ${index + 1}`);
      return textResult(output.join("\n"));
    }
    case "fail":
      return textResult(readString(args, "message", "fixture failure"), true);
    default:
      return textResult(`Unknown fixture tool: ${name}`, true);
  }
});

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exit(1);
}
