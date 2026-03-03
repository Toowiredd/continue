# Forge MCP Server

**A complete AI-powered software engineering toolkit as a standalone MCP server.**

Connect any MCP client (Claude Desktop, Cursor, Zed, custom agents, etc.) and get a full
AI dev environment — no IDE or editor required. Forge exposes 33 tools covering every
capability you'd expect from a top-tier AI coding assistant.

---

## Installation

```bash
npm install -g forge-mcp
```

> **Note:** If `forge-mcp` is not yet published to npm, install from source:
> ```bash
> git clone https://github.com/Toowiredd/continue
> cd continue
> cd packages/mcp-server && npm install && npm run build
> # Then use the absolute path in your MCP client config
> ```

## Usage

### STDIO Transport (Claude Desktop, Cursor, Zed, etc.)

Add to your MCP client config (e.g. `~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "forge": {
      "command": "forge",
      "args": []
    }
  }
}
```

Or with a local path:

```json
{
  "mcpServers": {
    "forge": {
      "command": "node",
      "args": ["path/to/forge-mcp/dist/index.js"]
    }
  }
}
```

### SSE Transport (web clients, custom integrations)

```bash
forge --transport sse --port 3100
```

Then connect to `http://localhost:3100/mcp`.

### VS Code Extension Integration

Set in VS Code settings:

```json
{
  "forge.mcpServer.enabled": true,
  "forge.mcpServer.port": 3100
}
```

---

## Tools (33 total)

### Filesystem

| Tool | Description |
|------|-------------|
| `read_file` | Read the full contents of a file (max 100k chars). Required before `edit_file` / `multi_edit_file`. |
| `read_file_range` | Read a specific line range from a large file (e.g. lines 50–100). |
| `write_file` | Write or overwrite a file. Creates parent directories. Returns a diff if overwriting. |
| `create_file` | Create a new file. Fails if file already exists (use `write_file` to overwrite). |
| `edit_file` | Exact string find-and-replace in an existing file. Requires prior `read_file`. |
| `multi_edit_file` | Multiple sequential find-and-replace edits in one call. Requires prior `read_file`. |
| `list_dir` | List a directory's contents with file type and size. |

### Search

| Tool | Description |
|------|-------------|
| `glob_search` | Find files by glob pattern (e.g. `**/*.ts`). Uses ripgrep if available. |
| `search_code` | Search code with regex/literal pattern. Respects `.gitignore`. Uses ripgrep → grep fallback. |

### Shell

| Tool | Description |
|------|-------------|
| `bash` | Execute any shell command. OS-aware shell detection (bash/zsh on Unix, PowerShell on Windows). Configurable timeout up to 600s. |

### Network

| Tool | Description |
|------|-------------|
| `fetch_url` | Fetch a URL and return its content as plain text (HTML stripped). |

### Git

| Tool | Description |
|------|-------------|
| `view_diff` | Show uncommitted changes (`git diff` + `git diff --staged`). |
| `view_repo_map` | Display the repository file tree (configurable depth, excludes `node_modules`). |

### AI / LLM

| Tool | Description |
|------|-------------|
| `forge_chat` | Multi-turn AI conversation with the configured model. Use for code review, explanations, planning, refactoring. |
| `forge_autocomplete` | AI inline code completion at a given file + cursor position. |
| `forge_run_slash_command` | Run built-in slash commands: `commit`, `review`, `cmd`, `onboard`, `draftIssue`, `http`, `share`. |
| `forge_compact_conversation` | Summarize a long conversation history to reduce token usage. |

### Model Management

| Tool | Description |
|------|-------------|
| `forge_list_models` | List all configured AI models grouped by role. Shows current selection for each role. |
| `forge_switch_model` | Change the selected model for a role (chat, autocomplete, edit, apply, embed, rerank). |

### Chat History

| Tool | Description |
|------|-------------|
| `forge_history_list` | List all saved chat sessions (most recent first). |
| `forge_history_load` | Load a specific session by ID. |
| `forge_history_save` | Save or update a chat session. |
| `forge_history_delete` | Delete a session by ID. |

### Configuration

| Tool | Description |
|------|-------------|
| `forge_get_config` | Return the fully-resolved configuration (models, context providers, rules, prompts, MCP servers). |
| `forge_add_rule` | Add a new AI behavior rule (code style, conventions, etc.) persisted in `~/.continue/rules/`. |
| `forge_delete_rule` | Delete a rule file by path. |
| `forge_add_model` | Add a new AI model (any provider: openai, anthropic, ollama, gemini, mistral, etc.). |
| `forge_delete_model` | Remove a model from the configuration by title. |

### Indexing & Docs

| Tool | Description |
|------|-------------|
| `forge_index_codebase` | Trigger semantic codebase indexing or query its status. |
| `forge_add_docs` | Add a documentation URL to the AI index (crawled and searchable via `@docs`). |
| `forge_remove_docs` | Remove a documentation source by its start URL. |

### Context Retrieval

| Tool | Description |
|------|-------------|
| `forge_context_retrieval` | Run any context provider and get ranked results. Providers: `codebase`, `docs`, `diff`, `terminal`, `file`, `folder`, `web`, `clipboard`, `os`, `search`. |

### Statistics

| Tool | Description |
|------|-------------|
| `forge_get_token_stats` | Get AI token usage statistics (per day, per model, or both). |

---

## Resources

| URI | Description |
|-----|-------------|
| `forge://config` | Fully-resolved configuration as JSON |
| `forge://index/status` | Codebase indexing progress and stats |
| `forge://stats` | Token usage statistics |
| `forge://context/{type}` | Output from a named context provider |
| `forge://history/{session_id}` | A saved chat session |

---

## Slash Commands (`forge_run_slash_command`)

| Command | Description |
|---------|-------------|
| `commit` | Generate a git commit message from the current diff |
| `review` | Perform a code review on current changes |
| `cmd` | Generate a terminal command from a plain-English description |
| `onboard` | Generate an onboarding document for the current codebase |
| `draftIssue` | Draft a GitHub issue |
| `http` | Generate an HTTP/curl request from a description |
| `share` | Export conversation (headless: saves locally via `forge_history_save`) |

---

## Configuration

Forge reads its AI configuration from `~/.continue/config.yaml` (same format as the AI
coding assistant this server is based on). Example:

```yaml
name: My Config
version: "1.0.0"
schema: v1
models:
  - provider: openai
    model: gpt-4o
    title: GPT-4o
    roles: [chat, edit]
    apiKey: sk-...

  - provider: anthropic
    model: claude-3-5-sonnet-latest
    title: Claude 3.5 Sonnet
    roles: [chat]
    apiKey: sk-ant-...

  - provider: ollama
    model: codellama:7b-code
    title: CodeLlama (local)
    roles: [autocomplete]
    apiBase: http://localhost:11434
```

You can also manage models at runtime using `forge_add_model` and `forge_delete_model`.

---

## Example Workflows

### Generate a commit message
```json
{ "command": "commit" }
```
via `forge_run_slash_command`

### Ask an AI question about your code
```json
{
  "messages": [
    { "role": "user", "content": "Explain what the auth middleware does in this codebase" }
  ]
}
```
via `forge_chat`

### Find and fix a bug
```json
{ "pattern": "TODO|FIXME|HACK", "file_pattern": "*.ts" }
```
via `search_code`, then `read_file` + `edit_file` to fix.

### Add a docs source
```json
{ "start_url": "https://docs.python.org/3/", "title": "Python 3" }
```
via `forge_add_docs`

---

## Architecture

Forge is a headless server that embeds the full AI coding engine. When started:

1. Loads configuration from `~/.continue/config.yaml`
2. Initializes the AI model pipeline (chat, autocomplete, embeddings)
3. Starts the codebase semantic indexer (background)
4. Serves all 33 tools via MCP (stdio or SSE transport)

No browser, no GUI, no VS Code required.

---

## License

MIT
