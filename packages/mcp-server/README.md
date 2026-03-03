# @continue/mcp-server

**The Continue.dev VS Code extension experience as a standalone MCP server — a complete SWE dev solution.**

Connect any MCP client (Claude Desktop, Cursor, Zed, custom agents, etc.) and get the full Continue.dev toolkit:
file I/O, code search, bash execution, git diff, URL fetching, LLM chat, codebase semantic search, and more.

---

## Installation

```bash
npm install -g @continue/mcp-server
```

## Usage

### STDIO Transport (Claude Desktop, Cursor, Zed, etc.)

Add to your MCP client config (e.g. `~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "continue": {
      "command": "node",
      "args": ["path/to/@continue/mcp-server/dist/index.js"]
    }
  }
}
```

### SSE Transport (network / custom agents)

```bash
node dist/index.js --transport sse --port 3100
```

Then connect your client to `http://localhost:3100/mcp`.

### VS Code opt-in

Set `continue.mcpServer.enabled = true` in VS Code settings to start the MCP server
alongside the extension (uses the same config, port configurable via `continue.mcpServer.port`).

---

## Tools

### Filesystem

| Tool | Description |
|------|-------------|
| `read_file` | Read a file's full contents. **Must be called before `edit_file` or `multi_edit_file`.** |
| `write_file` | Write (or create) a file. Creates parent directories automatically. Returns a diff if the file existed. |
| `edit_file` | Exact find-and-replace in an existing file. Fails if `old_string` is not unique (use `replace_all=true` to replace all occurrences). Requires a prior `read_file` call. |
| `multi_edit_file` | Multiple sequential find-and-replace operations in a single call. Each edit operates on the result of the previous. Requires a prior `read_file` call. |
| `list_dir` | List files and subdirectories in a directory with type and size. |

### Search

| Tool | Description |
|------|-------------|
| `glob_search` | Find files matching a glob pattern (e.g. `**/*.ts`, `src/**/*.{js,jsx}`). Uses ripgrep if available. |
| `search_code` | Search code using ripgrep (falls back to grep). Returns file path, line number and matched line. Supports case-insensitive matching and file-pattern filters. |

### Shell & Network

| Tool | Description |
|------|-------------|
| `bash` | Execute a shell command and return stdout/stderr. Supports `timeout` (max 600 s) and custom `cwd`. |
| `fetch_url` | Fetch a URL and return its content as plain text (HTML tags stripped). |

### Git

| Tool | Description |
|------|-------------|
| `view_diff` | Show uncommitted changes (`git diff` + `git diff --staged`). Can target a specific repo path or show only staged changes. |
| `view_repo_map` | Display the file/directory tree of a repository (respects `node_modules` / dotfile exclusion). Configurable max depth. |

### Continue AI (powered by your `~/.continue/config.yaml`)

| Tool | Description |
|------|-------------|
| `continue_chat` | Send a multi-turn conversation to the configured LLM (code review, explanation, planning, etc.). Optionally specify a model by title. |
| `continue_get_config` | Return the fully-resolved Continue config: all models, context providers, slash commands, MCP servers, rules, prompts. |
| `continue_index_codebase` | Trigger (`action=trigger`) or query status (`action=status`) of the semantic codebase index. |
| `continue_context_retrieval` | Run a named context provider (`codebase`, `docs`, `web`, `file`, `diff`, `terminal`, etc.) and return ranked context items. |

---

## Resources

| Resource URI | Description |
|---|---|
| `continue://config` | Live resolved config as JSON |
| `continue://index/status` | Codebase indexing progress |
| `continue://context/{type}` | Output of a named context provider |

---

## Example workflows

### Review a PR diff with AI

```
1. view_diff {}
2. continue_chat { messages: [{ role: "user", content: "Review this diff:\n<paste diff>" }] }
```

### Refactor a file

```
1. read_file { filepath: "src/utils.ts" }
2. multi_edit_file { filepath: "src/utils.ts", edits: [ { old_string: "...", new_string: "..." }, ... ] }
3. bash { command: "npx tsc --noEmit" }
```

### Find and fix a bug

```
1. search_code { pattern: "TODO|FIXME", path: "src/" }
2. read_file { filepath: "<matched file>" }
3. edit_file { filepath: "...", old_string: "...", new_string: "..." }
4. bash { command: "npm test -- --testPathPattern=<file>" }
```

