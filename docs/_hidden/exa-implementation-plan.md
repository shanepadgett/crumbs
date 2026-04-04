# Plan: Implementing Exa Code Search (MCP)

This plan describes how OpenCode implements Exa search using their MCP (Model Context Protocol) bridge, which can be adapted for any web/code search functionality.

## Core Integration Strategy

OpenCode uses the Exa MCP endpoint at `https://mcp.exa.ai/mcp`. This endpoint acts as a JSON-RPC gateway to Exa's search tools.

### 1. API Configuration
- **Base URL**: `https://mcp.exa.ai`
- **Endpoint**: `/mcp`
- **Method**: `POST`
- **Headers**:
  ```json
  {
    "accept": "application/json, text/event-stream",
    "content-type": "application/json"
  }
  ```

### 2. Request Structure (JSON-RPC)
The payload follows the MCP `tools/call` pattern:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_code_context_exa", 
    "arguments": {
      "query": "React useState hook examples",
      "tokensNum": 5000
    }
  }
}
```
*Note: Use `web_search_exa` for general web search.*

### 3. Implementation Details

#### Handling the Response (Server-Sent Events)
The Exa MCP endpoint returns a stream of Server-Sent Events (SSE). You must parse the `data: ` lines:

```typescript
const responseText = await response.text();
const lines = responseText.split("\n");
for (const line of lines) {
  if (line.startsWith("data: ")) {
    const data = JSON.parse(line.substring(6));
    if (data.result?.content?.[0]?.text) {
      return data.result.content[0].text;
    }
  }
}
```

#### Search Types & Parameters
For `web_search_exa`, you can provide:
- `numResults`: (default 8)
- `livecrawl`: `"fallback"` | `"preferred"`
- `type`: `"auto"` | `"fast"` | `"deep"`
- `contextMaxCharacters`: (default 10000)

### 4. Code Snippet for Reference

```typescript
async function exaSearch(query: string) {
  const request = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "get_code_context_exa", // or "web_search_exa"
      arguments: { query, tokensNum: 5000 }
    }
  };

  const response = await fetch("https://mcp.exa.ai/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });

  const text = await response.text();
  const dataLine = text.split("\n").find(l => l.startsWith("data: "));
  return dataLine ? JSON.parse(dataLine.slice(6)).result.content[0].text : null;
}
```

## Integration into crumbs-github
1. Define a search client using the logic above.
2. Route web search requests through the `web_search_exa` tool name.
3. Route code/documentation requests through the `get_code_context_exa` tool name.
