# @continue/mcp-server

A Model Context Protocol (MCP) server that exposes Continue's capabilities (autocomplete, chat, codebase indexing, etc.) to any MCP client.

## Installation

```bash
npm install -g @continue/mcp-server
```

## Usage

### Stdio Transport (e.g. Claude Desktop)

```json
{
  "mcpServers": {
    "continue": {
      "command": "node",
      "args": ["path/to/dist/index.js"]
    }
  }
}
```

### SSE Transport (Networked)

```bash
node path/to/dist/index.js --transport sse --port 3100
```

## Tools Available

- `continue_autocomplete`: inline code completion at a given file path and cursor position
- `continue_chat`: multi-turn chat with the configured LLM, accepts messages array and returns assistant reply
- `continue_edit`: apply a natural-language edit instruction to a specified code range
- `continue_context_retrieval`: run the full context provider pipeline (codebase, docs, web, terminal, etc.) and return ranked context items
- `continue_index_codebase`: trigger or query status of the codebase indexing pipeline
- `continue_run_slash_command`: execute any registered slash command by name with optional arguments
- `continue_get_config`: return the current fully-resolved config (models, providers, context providers, slash commands)

## Resources Available

- `continue://config`: live resolved config as JSON
- `continue://index/status`: indexing progress and stats
- `continue://context/{type}`: output of a named context provider
