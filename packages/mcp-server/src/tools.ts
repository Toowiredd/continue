/**
 * Forge — AI-Powered SWE Dev Solution as an MCP Server
 *
 * Exposes the complete software engineering toolkit as standalone MCP tools.
 * No IDE or editor required — connect any MCP client and get a full dev environment.
 *
 * Tool categories:
 *   Filesystem  : read_file, read_file_range, write_file, create_file,
 *                 edit_file, multi_edit_file, list_dir
 *   Search      : glob_search, search_code
 *   Shell       : bash
 *   Network     : fetch_url
 *   Git         : view_diff, view_repo_map
 *   AI / LLM    : forge_chat, forge_autocomplete, forge_run_slash_command,
 *                 forge_compact_conversation
 *   Models      : forge_list_models, forge_switch_model
 *   History     : forge_history_list, forge_history_load,
 *                 forge_history_save, forge_history_delete
 *   Config      : forge_get_config, forge_add_rule, forge_delete_rule,
 *                 forge_add_model, forge_delete_model
 *   Indexing    : forge_index_codebase, forge_add_docs, forge_remove_docs
 *   Context     : forge_context_retrieval
 *   Stats       : forge_get_token_stats
 */
import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Core } from "core";

const execPromise = util.promisify(child_process.exec);

// ---------------------------------------------------------------------------
// Session-level read tracking — edit_file / multi_edit_file require a prior read
// ---------------------------------------------------------------------------
export const readFilesSet = new Set<string>();

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------
function getShellCommand(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-ExecutionPolicy", "Bypass", "-Command", command],
    };
  }
  const userShell = process.env.SHELL || "/bin/bash";
  return { shell: userShell, args: ["-l", "-c", command] };
}

// ---------------------------------------------------------------------------
// Find-and-replace utility
// ---------------------------------------------------------------------------
function findAndReplace(
  content: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): string {
  if (oldStr === "") {
    return newStr + content;
  }
  const occurrences = content.split(oldStr).length - 1;
  if (occurrences === 0) {
    throw new Error(`String not found in file: "${oldStr}"`);
  }
  if (!replaceAll && occurrences > 1) {
    throw new Error(
      `String appears ${occurrences} times. Use replace_all=true, or provide more surrounding context.`,
    );
  }
  return replaceAll
    ? content.split(oldStr).join(newStr)
    : content.replace(oldStr, newStr);
}

// ---------------------------------------------------------------------------
// Unified diff (line-by-line)
// ---------------------------------------------------------------------------
function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [`--- ${filePath}`, `+++ ${filePath}`];
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (
      i < oldLines.length &&
      j < newLines.length &&
      oldLines[i] === newLines[j]
    ) {
      lines.push(` ${oldLines[i]}`);
      i++;
      j++;
    } else {
      while (
        i < oldLines.length &&
        (j >= newLines.length || oldLines[i] !== newLines[j])
      ) {
        lines.push(`-${oldLines[i++]}`);
      }
      while (
        j < newLines.length &&
        (i >= oldLines.length || oldLines[i] !== newLines[j])
      ) {
        lines.push(`+${newLines[j++]}`);
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output truncation
// ---------------------------------------------------------------------------
const MAX_OUTPUT_CHARS = 50_000;

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return (
    text.substring(0, max) +
    `\n\n[Output truncated at ${max.toLocaleString()} characters]`
  );
}

// ---------------------------------------------------------------------------
// Gitignore helpers
// ---------------------------------------------------------------------------
function loadGitignorePatterns(): string[] {
  const gitIgnorePath = path.join(process.cwd(), ".gitignore");
  if (!fs.existsSync(gitIgnorePath)) return [];
  return fs
    .readFileSync(gitIgnorePath, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"));
}

async function checkRipgrepAvailable(): Promise<boolean> {
  try {
    await execPromise("rg --version");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Directory tree builder
// ---------------------------------------------------------------------------
function buildRepoTree(
  dir: string,
  prefix: string,
  depth: number,
  maxDepth: number,
): string[] {
  if (depth > maxDepth) return [`${prefix}...`];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const filtered = entries.filter(
    (e) => !e.name.startsWith(".") && e.name !== "node_modules",
  );
  return filtered.flatMap((e, idx) => {
    const isLast = idx === filtered.length - 1;
    const connector = isLast ? "\u2514\u2500\u2500 " : "\u251c\u2500\u2500 ";
    const childPrefix = isLast ? prefix + "    " : prefix + "\u2502   ";
    if (e.isDirectory()) {
      return [
        `${prefix}${connector}${e.name}/`,
        ...buildRepoTree(path.join(dir, e.name), childPrefix, depth + 1, maxDepth),
      ];
    }
    return [`${prefix}${connector}${e.name}`];
  });
}

// ===========================================================================
// TOOL DEFINITIONS
// ===========================================================================

const TOOLS: Tool[] = [
  // ── Filesystem ─────────────────────────────────────────────────────────────
  {
    name: "read_file",
    description:
      "Read the full contents of a file. Must be called before edit_file or multi_edit_file on the same file.",
    inputSchema: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path to the file" },
      },
    },
  },
  {
    name: "read_file_range",
    description:
      "Read a specific range of lines from a file. Useful for large files where reading everything would exceed limits.",
    inputSchema: {
      type: "object",
      required: ["filepath", "start_line", "end_line"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path to the file" },
        start_line: { type: "number", description: "First line to read (1-indexed, inclusive)" },
        end_line: { type: "number", description: "Last line to read (1-indexed, inclusive)" },
      },
    },
  },
  {
    name: "write_file",
    description:
      "Write or overwrite a file with the given content. Creates parent directories automatically. Returns a diff if the file already existed.",
    inputSchema: {
      type: "object",
      required: ["filepath", "content"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Full file content to write" },
      },
    },
  },
  {
    name: "create_file",
    description:
      "Create a new file. Fails if the file already exists (use write_file to overwrite).",
    inputSchema: {
      type: "object",
      required: ["filepath", "content"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path for the new file" },
        content: { type: "string", description: "Content of the new file" },
      },
    },
  },
  {
    name: "edit_file",
    description:
      "Perform an exact string replacement in an existing file.\nIMPORTANT: You must call read_file on this file before calling edit_file.\n- old_string must match the file exactly (including whitespace/indentation).\n- Set replace_all=true to replace all occurrences; otherwise fails if string appears more than once.",
    inputSchema: {
      type: "object",
      required: ["filepath", "old_string", "new_string"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path to the file" },
        old_string: { type: "string", description: "The exact text to replace" },
        new_string: { type: "string", description: "The replacement text" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
      },
    },
  },
  {
    name: "multi_edit_file",
    description:
      "Perform multiple exact string replacements in a single file in one call.\nEdits are applied sequentially. Each operates on the result of the previous.\nIMPORTANT: You must call read_file on this file before calling multi_edit_file.",
    inputSchema: {
      type: "object",
      required: ["filepath", "edits"],
      properties: {
        filepath: { type: "string", description: "Absolute or relative path to the file" },
        edits: {
          type: "array",
          description: "Array of edit operations to apply in order",
          items: {
            type: "object",
            required: ["old_string", "new_string"],
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  {
    name: "list_dir",
    description:
      "List files and subdirectories in a directory with type and size information.",
    inputSchema: {
      type: "object",
      properties: {
        dirpath: {
          type: "string",
          description: "Path to directory (defaults to current working directory)",
        },
      },
    },
  },
  // ── Search ──────────────────────────────────────────────────────────────────
  {
    name: "glob_search",
    description:
      "Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.{js,jsx}'). Uses ripgrep if available.",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string", description: "Glob pattern to match files against" },
        cwd: { type: "string", description: "Directory to search from (defaults to process.cwd())" },
      },
    },
  },
  {
    name: "search_code",
    description:
      "Search code using ripgrep (falls back to grep). Returns file path, line number, and matched line. Respects .gitignore.",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: { type: "string", description: "Regex or literal search pattern" },
        path: { type: "string", description: "Directory or file to search (defaults to cwd)" },
        file_pattern: { type: "string", description: "Glob to filter files, e.g. '*.ts'" },
        case_sensitive: { type: "boolean", description: "Case-sensitive search (default false)" },
      },
    },
  },
  // ── Shell ───────────────────────────────────────────────────────────────────
  {
    name: "bash",
    description:
      "Execute a shell command and return stdout/stderr.\n- Prefer file tools (read_file/write_file/edit_file) over bash for file operations.\n- Use timeout for long-running commands (max 600 seconds).",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string", description: "The shell command to run" },
        timeout: { type: "number", description: "Timeout in seconds (default 120, max 600)" },
        cwd: { type: "string", description: "Working directory for the command" },
      },
    },
  },
  // ── Network ─────────────────────────────────────────────────────────────────
  {
    name: "fetch_url",
    description:
      "Fetch a URL and return its content as plain text (HTML tags stripped). Useful for reading documentation, GitHub issues, or any web page.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "The URL to fetch" },
      },
    },
  },
  // ── Git ─────────────────────────────────────────────────────────────────────
  {
    name: "view_diff",
    description:
      "Show uncommitted git changes (unstaged + staged by default). Set staged=true for staged-only changes.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the git repo (defaults to cwd)" },
        staged: { type: "boolean", description: "Show staged changes only (default false)" },
      },
    },
  },
  {
    name: "view_repo_map",
    description:
      "Display the file/directory tree of a repository. Excludes node_modules and dotfiles. Configure depth with max_depth.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Root directory to map (defaults to cwd)" },
        max_depth: { type: "number", description: "Maximum directory depth (default 4)" },
      },
    },
  },
  // ── AI / LLM (forge_ prefix) ────────────────────────────────────────────────
  {
    name: "forge_chat",
    description:
      "Send a multi-turn conversation to the configured AI model and return the assistant reply. Use for code review, explanations, planning, refactoring, and any AI coding task.",
    inputSchema: {
      type: "object",
      required: ["messages"],
      properties: {
        messages: {
          type: "array",
          description: "Conversation history",
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string", enum: ["user", "assistant", "system"] },
              content: { type: "string" },
            },
          },
        },
        model: {
          type: "string",
          description: "Model title from config (uses default chat model if omitted)",
        },
      },
    },
  },
  {
    name: "forge_autocomplete",
    description:
      "Get an AI inline code completion at a given file path and cursor position. Returns the suggested code to insert at that position.",
    inputSchema: {
      type: "object",
      required: ["filepath", "line", "character"],
      properties: {
        filepath: { type: "string", description: "Path to the file being edited" },
        line: { type: "number", description: "0-indexed cursor line number" },
        character: { type: "number", description: "0-indexed cursor character position" },
        recently_edited_ranges: {
          type: "array",
          description: "Recently edited ranges for context (optional)",
          items: { type: "object" },
        },
      },
    },
  },
  {
    name: "forge_run_slash_command",
    description:
      "Run a built-in AI slash command and return the result.\nAvailable commands:\n  commit     — Generate a git commit message from the current diff\n  review     — Code review of current changes\n  cmd        — Generate a terminal command from a description\n  onboard    — Generate a codebase onboarding document\n  draftIssue — Draft a GitHub issue\n  http       — Generate an HTTP request\n  share      — Export conversation (headless: saves locally)",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          enum: ["commit", "review", "cmd", "onboard", "draftIssue", "http", "share"],
          description: "The slash command name",
        },
        input: { type: "string", description: "Additional input or context for the command" },
        include_unstaged: {
          type: "boolean",
          description: "For 'commit' — include unstaged changes (default false)",
        },
      },
    },
  },
  {
    name: "forge_compact_conversation",
    description:
      "Summarize and compact a long chat history to reduce token usage while preserving important context.",
    inputSchema: {
      type: "object",
      required: ["history"],
      properties: {
        history: {
          type: "array",
          description: "The conversation history to compact",
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string", enum: ["user", "assistant", "system"] },
              content: { type: "string" },
            },
          },
        },
      },
    },
  },
  // ── Models ──────────────────────────────────────────────────────────────────
  {
    name: "forge_list_models",
    description:
      "List all configured AI models, grouped by their assigned roles (chat, autocomplete, edit, apply, embed, rerank). Shows which model is currently selected for each role.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "forge_switch_model",
    description:
      "Change the selected AI model for a given role (chat, autocomplete, edit, apply, embed, rerank).",
    inputSchema: {
      type: "object",
      required: ["role", "model_title"],
      properties: {
        role: {
          type: "string",
          enum: ["chat", "autocomplete", "edit", "apply", "embed", "rerank"],
          description: "The role to update",
        },
        model_title: {
          type: "string",
          description: "The title of the model to switch to (must match a configured model)",
        },
      },
    },
  },
  // ── History ─────────────────────────────────────────────────────────────────
  {
    name: "forge_history_list",
    description:
      "List all saved AI chat sessions, sorted by most recent. Returns session IDs, titles, and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of sessions to return (default 20)" },
      },
    },
  },
  {
    name: "forge_history_load",
    description:
      "Load a specific chat session by its ID and return the full conversation history.",
    inputSchema: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string", description: "The session ID to load" },
      },
    },
  },
  {
    name: "forge_history_save",
    description:
      "Save or update a chat session. Creates a new session if no session_id is provided.",
    inputSchema: {
      type: "object",
      required: ["history"],
      properties: {
        session_id: { type: "string", description: "Existing session ID to update (omit to create new)" },
        title: { type: "string", description: "Title for the session" },
        history: {
          type: "array",
          description: "Conversation messages to save",
          items: {
            type: "object",
            required: ["role", "content"],
            properties: {
              role: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    name: "forge_history_delete",
    description: "Delete a saved chat session by its ID.",
    inputSchema: {
      type: "object",
      required: ["session_id"],
      properties: {
        session_id: { type: "string", description: "The session ID to delete" },
      },
    },
  },
  // ── Config ──────────────────────────────────────────────────────────────────
  {
    name: "forge_get_config",
    description:
      "Return the fully-resolved Forge configuration: all models, context providers, MCP servers, rules, prompts, and settings.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "forge_add_rule",
    description:
      "Add a new AI rule that guides assistant behavior (code style, conventions, patterns, etc.). Rules are persisted in ~/.continue/rules/.",
    inputSchema: {
      type: "object",
      required: ["name", "rule"],
      properties: {
        name: { type: "string", description: "Name for the rule (e.g. 'typescript-style', 'no-console')" },
        rule: { type: "string", description: "The rule content in natural language or markdown" },
      },
    },
  },
  {
    name: "forge_delete_rule",
    description: "Delete an AI rule file by its absolute path.",
    inputSchema: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: { type: "string", description: "Absolute path to the rule file to delete" },
      },
    },
  },
  {
    name: "forge_add_model",
    description:
      "Add a new AI model to the configuration. Supports all providers: openai, anthropic, ollama, gemini, mistral, and more.",
    inputSchema: {
      type: "object",
      required: ["provider", "model"],
      properties: {
        provider: { type: "string", description: "Provider name (e.g. 'openai', 'anthropic', 'ollama', 'gemini')" },
        model: { type: "string", description: "Model name (e.g. 'gpt-4o', 'claude-3-5-sonnet-latest', 'llama3.2')" },
        title: { type: "string", description: "Display title for this model (defaults to model name)" },
        role: {
          type: "string",
          enum: ["chat", "autocomplete", "edit", "apply", "embed", "rerank"],
          description: "Role to assign to this model (defaults to 'chat')",
        },
        api_key: { type: "string", description: "API key (if required by the provider)" },
        api_base: { type: "string", description: "Custom API base URL (for local or proxied models)" },
      },
    },
  },
  {
    name: "forge_delete_model",
    description: "Remove a model from the configuration by its display title.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "The model display title to remove" },
      },
    },
  },
  // ── Indexing / Docs ─────────────────────────────────────────────────────────
  {
    name: "forge_index_codebase",
    description:
      "Trigger or query the semantic codebase index (used by the codebase context provider for AI-powered code search).",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["trigger", "status"],
          description: "'trigger' starts (re-)indexing; 'status' returns current state",
        },
      },
    },
  },
  {
    name: "forge_add_docs",
    description:
      "Add a documentation source to the AI index. The docs will be crawled and made available via the @docs context provider.",
    inputSchema: {
      type: "object",
      required: ["start_url"],
      properties: {
        start_url: { type: "string", description: "The root URL of the documentation to index (e.g. 'https://docs.python.org/3/')" },
        title: { type: "string", description: "Display name for this docs source" },
      },
    },
  },
  {
    name: "forge_remove_docs",
    description: "Remove a documentation source from the AI index by its start URL.",
    inputSchema: {
      type: "object",
      required: ["start_url"],
      properties: {
        start_url: { type: "string", description: "The start URL of the docs source to remove" },
      },
    },
  },
  // ── Context ─────────────────────────────────────────────────────────────────
  {
    name: "forge_context_retrieval",
    description:
      "Run a named context provider and return ranked context items for use in AI prompts.\nAvailable providers: codebase (semantic search), docs (indexed docs), diff (git diff), terminal (terminal output), file (file contents), folder (folder), web (live web search), clipboard, os, search (text search).",
    inputSchema: {
      type: "object",
      required: ["name", "query"],
      properties: {
        name: { type: "string", description: "Context provider name" },
        query: { type: "string", description: "Query or input for the context provider" },
        full_input: { type: "string", description: "Full user input (defaults to query)" },
      },
    },
  },
  // ── Stats ───────────────────────────────────────────────────────────────────
  {
    name: "forge_get_token_stats",
    description:
      "Get AI token usage statistics across all sessions — tokens used per day and per model.",
    inputSchema: {
      type: "object",
      properties: {
        group_by: {
          type: "string",
          enum: ["day", "model", "both"],
          description: "Group statistics by day, model, or both (default 'both')",
        },
      },
    },
  },
];

// ===========================================================================
// HANDLER IMPLEMENTATIONS
// ===========================================================================

async function handleReadFile(args: any): Promise<string> {
  const { filepath } = args;
  if (!filepath) throw new Error("filepath is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const content = fs.readFileSync(resolved, "utf-8");
  const MAX_READ_CHARS = 100_000;
  if (content.length > MAX_READ_CHARS) {
    throw new Error(
      `File too large (${content.length.toLocaleString()} chars). ` +
        `Max: ${MAX_READ_CHARS.toLocaleString()} chars. ` +
        `Use read_file_range for large files, or bash with head/tail/sed.`,
    );
  }
  readFilesSet.add(resolved);
  return `Content of ${resolved}:\n${content}`;
}

async function handleReadFileRange(args: any): Promise<string> {
  const { filepath, start_line, end_line } = args;
  if (!filepath) throw new Error("filepath is required");
  if (typeof start_line !== "number") throw new Error("start_line is required");
  if (typeof end_line !== "number") throw new Error("end_line is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  const content = fs.readFileSync(resolved, "utf-8");
  const lines = content.split("\n");
  const total = lines.length;
  const startIdx = Math.max(0, start_line - 1);
  const endIdx = Math.min(total - 1, end_line - 1);
  if (startIdx > endIdx)
    throw new Error(`start_line (${start_line}) must be <= end_line (${end_line})`);
  const selected = lines.slice(startIdx, endIdx + 1);
  const numbered = selected.map((l, i) => `${startIdx + i + 1}: ${l}`).join("\n");
  readFilesSet.add(resolved);
  return `${resolved} (lines ${start_line}\u2013${end_line} of ${total}):\n${numbered}`;
}

async function handleWriteFile(args: any): Promise<string> {
  const { filepath, content } = args;
  if (!filepath) throw new Error("filepath is required");
  if (content === undefined) throw new Error("content is required");
  const resolved = path.resolve(process.cwd(), filepath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existed = fs.existsSync(resolved);
  const oldContent = existed ? fs.readFileSync(resolved, "utf-8") : "";
  fs.writeFileSync(resolved, content, "utf-8");
  readFilesSet.add(resolved);
  if (existed && oldContent !== content) {
    const diff = generateUnifiedDiff(oldContent, content, resolved);
    return `Successfully updated ${resolved}\nDiff:\n${diff}`;
  }
  return existed ? `File unchanged: ${resolved}` : `Successfully created ${resolved}`;
}

async function handleCreateFile(args: any): Promise<string> {
  const { filepath, content } = args;
  if (!filepath) throw new Error("filepath is required");
  if (content === undefined) throw new Error("content is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (fs.existsSync(resolved))
    throw new Error(`File already exists: ${resolved}. Use write_file to overwrite.`);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, "utf-8");
  readFilesSet.add(resolved);
  return `Successfully created ${resolved}`;
}

async function handleEditFile(args: any): Promise<string> {
  const { filepath, old_string, new_string, replace_all = false } = args;
  if (!filepath) throw new Error("filepath is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  if (!readFilesSet.has(resolved))
    throw new Error(
      `You must call read_file on "${filepath}" before editing it in this session.`,
    );
  const oldContent = fs.readFileSync(resolved, "utf-8");
  const newContent = findAndReplace(oldContent, old_string, new_string, replace_all);
  fs.writeFileSync(resolved, newContent, "utf-8");
  const diff = generateUnifiedDiff(oldContent, newContent, resolved);
  return `Successfully edited ${resolved}\nDiff:\n${diff}`;
}

async function handleMultiEditFile(args: any): Promise<string> {
  const { filepath, edits } = args;
  if (!filepath) throw new Error("filepath is required");
  if (!Array.isArray(edits) || edits.length === 0)
    throw new Error("edits must be a non-empty array");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  if (!readFilesSet.has(resolved))
    throw new Error(
      `You must call read_file on "${filepath}" before editing it in this session.`,
    );
  const originalContent = fs.readFileSync(resolved, "utf-8");
  let current = originalContent;
  for (let i = 0; i < edits.length; i++) {
    const { old_string, new_string, replace_all = false } = edits[i];
    try {
      current = findAndReplace(current, old_string, new_string, replace_all);
    } catch (e: any) {
      throw new Error(`Edit ${i}: ${e.message}`);
    }
  }
  fs.writeFileSync(resolved, current, "utf-8");
  const diff = generateUnifiedDiff(originalContent, current, resolved);
  return `Successfully applied ${edits.length} edit(s) to ${resolved}\nDiff:\n${diff}`;
}

async function handleListDir(args: any): Promise<string> {
  const dirpath = args?.dirpath
    ? path.resolve(process.cwd(), args.dirpath)
    : process.cwd();
  if (!fs.existsSync(dirpath)) throw new Error(`Directory not found: ${dirpath}`);
  const entries = fs.readdirSync(dirpath, { withFileTypes: true });
  const lines = entries.map((e) => {
    const type = e.isDirectory() ? "dir " : "file";
    const size = e.isFile()
      ? ` (${fs.statSync(path.join(dirpath, e.name)).size.toLocaleString()} bytes)`
      : "";
    return `${type}  ${e.name}${size}`;
  });
  return `Contents of ${dirpath}:\n${lines.join("\n")}`;
}

async function handleGlobSearch(args: any): Promise<string> {
  const { pattern, cwd: cwdArg } = args;
  if (!pattern) throw new Error("pattern is required");
  const searchCwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
  const useRg = await checkRipgrepAvailable();
  let command: string;
  if (useRg) {
    command = `rg --files "${searchCwd}" -g "${pattern}"`;
  } else if (process.platform === "win32") {
    command = `Get-ChildItem -Recurse -Path "${searchCwd}" -Filter "${pattern}" | Select-Object -ExpandProperty FullName`;
  } else {
    command = `find "${searchCwd}" -type f -name "${pattern.replace("**/", "")}"`;
  }
  try {
    const { stdout } = await execPromise(command);
    const files = stdout.trim().split("\n").filter(Boolean);
    if (files.length === 0) return `No files match pattern: ${pattern}`;
    const limited = files.slice(0, 500);
    const note = files.length > 500 ? `\n[Showing 500 of ${files.length} matches]` : "";
    return `Files matching "${pattern}":\n${limited.join("\n")}${note}`;
  } catch (e: any) {
    if (e.code === 1) return `No files match pattern: ${pattern}`;
    throw new Error(`Glob search failed: ${e.message}`);
  }
}

async function handleSearchCode(args: any): Promise<string> {
  const { pattern, path: searchPath, file_pattern, case_sensitive = false } = args;
  if (!pattern) throw new Error("pattern is required");
  const target = searchPath ? path.resolve(process.cwd(), searchPath) : process.cwd();
  if (!fs.existsSync(target)) throw new Error(`Path not found: ${target}`);
  const ignorePatterns = loadGitignorePatterns();
  let stdout = "";
  const useRg = await checkRipgrepAvailable();
  if (useRg) {
    let cmd = `rg --line-number --with-filename --color never`;
    if (!case_sensitive) cmd += " --ignore-case";
    if (file_pattern) cmd += ` -g "${file_pattern}"`;
    for (const ig of ignorePatterns) cmd += ` -g "!${ig}"`;
    cmd += ` "${pattern}" "${target}"`;
    try {
      const result = await execPromise(cmd);
      stdout = result.stdout;
    } catch (e: any) {
      if (e.code === 1) stdout = "";
      else throw e;
    }
  } else {
    const flag = case_sensitive ? "" : " -i";
    let cmd: string;
    if (process.platform === "win32") {
      cmd = `findstr /S /N /P${case_sensitive ? "" : " /I"} /R "${pattern}" "${file_pattern || "*"}" /D:"${target}"`;
    } else {
      const excludeArgs = ignorePatterns
        .map((p) => `--exclude="${p}" --exclude-dir="${p}"`)
        .join(" ");
      if (file_pattern) {
        cmd = `find "${target}" -type f -name "${file_pattern}" -print0 | xargs -0 grep -nH${flag} -I ${excludeArgs} "${pattern}"`;
      } else {
        cmd = `grep -R -n -H${flag} -I ${excludeArgs} "${pattern}" "${target}"`;
      }
    }
    try {
      const result = await execPromise(cmd, { cwd: target });
      stdout = result.stdout;
    } catch (e: any) {
      if (e.code === 1) stdout = "";
      else throw e;
    }
  }
  if (!stdout.trim()) {
    return `No matches found for pattern "${pattern}"${file_pattern ? ` in files matching "${file_pattern}"` : ""}.`;
  }
  const lines = stdout.split("\n").filter(Boolean);
  const limited = lines.slice(0, 100);
  const note = lines.length > 100 ? `\n[Showing 100 of ${lines.length} matches]` : "";
  return `Search results for "${pattern}":\n\n${limited.join("\n")}${note}`;
}

async function handleBash(args: any): Promise<string> {
  const { command, timeout: timeoutSecs, cwd: cwdArg } = args;
  if (!command) throw new Error("command is required");
  const timeoutMs = Math.min((timeoutSecs ?? 120) * 1000, 600_000);
  const cwdOpt = cwdArg ? path.resolve(cwdArg) : process.cwd();
  return new Promise((resolve, reject) => {
    const { shell, args: shellArgs } = getShellCommand(command);
    const child = child_process.spawn(shell, shellArgs, { cwd: cwdOpt });
    let stdout = "";
    let stderr = "";
    let isDone = false;
    const timeoutId = setTimeout(() => {
      if (isDone) return;
      isDone = true;
      child.kill("SIGTERM");
      resolve(
        truncate(stdout + (stderr ? `\nStderr: ${stderr}` : "")) +
          `\n[Timed out after ${timeoutSecs ?? 120}s]`,
      );
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeoutId);
      if (code !== 0 && stderr) {
        reject(new Error(`Exit code ${code}: ${stderr}`));
        return;
      }
      const output = stdout + (stderr ? `\nStderr: ${stderr}` : "");
      resolve(truncate(output) || "(no output)");
    });
    child.on("error", (e) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timeoutId);
      reject(e);
    });
  });
}

async function handleFetchUrl(args: any): Promise<string> {
  const { url } = args;
  if (!url) throw new Error("url is required");
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const html = await res.text();
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s{2,}/g, " ")
      .trim();
    return truncate(text, 20_000);
  } catch (e: any) {
    throw new Error(`Failed to fetch ${url}: ${e.message}`);
  }
}

async function handleViewDiff(args: any): Promise<string> {
  const { path: repoPath, staged = false } = args;
  const cwd = repoPath ? path.resolve(repoPath) : process.cwd();
  if (!fs.existsSync(cwd)) throw new Error(`Path not found: ${cwd}`);
  try {
    await execPromise("git rev-parse --is-inside-work-tree", { cwd });
  } catch {
    throw new Error(`Not a git repository: ${cwd}`);
  }
  const cmds = staged ? ["git diff --staged"] : ["git diff", "git diff --staged"];
  const parts: string[] = [];
  for (const cmd of cmds) {
    const { stdout } = await execPromise(cmd, { cwd });
    if (stdout.trim()) parts.push(stdout);
  }
  if (parts.length === 0) return "No changes in the repository.";
  return truncate(parts.join("\n\n"), 50_000);
}

async function handleViewRepoMap(args: any): Promise<string> {
  const { path: repoPath, max_depth = 4 } = args;
  const root = repoPath ? path.resolve(repoPath) : process.cwd();
  if (!fs.existsSync(root)) throw new Error(`Path not found: ${root}`);
  const lines = [root, ...buildRepoTree(root, "", 0, max_depth)];
  return truncate(lines.join("\n"), 30_000);
}

async function handleForgeChat(args: any, core: Core): Promise<string> {
  const { messages, model } = args;
  if (!Array.isArray(messages) || messages.length === 0)
    throw new Error("messages must be a non-empty array");
  let result = "";
  for await (const chunk of core.invoke("llm/streamChat", {
    messages,
    title: model || "",
    completionOptions: {},
  }) as any) {
    if (chunk?.content) result += chunk.content;
  }
  return result || "(no response)";
}

async function handleForgeAutocomplete(args: any, core: Core): Promise<string> {
  const { filepath, line, character, recently_edited_ranges = [] } = args;
  if (!filepath) throw new Error("filepath is required");
  if (typeof line !== "number") throw new Error("line is required");
  if (typeof character !== "number") throw new Error("character is required");
  const completions = await core.invoke("autocomplete/complete", {
    filepath: path.resolve(process.cwd(), filepath),
    pos: { line, character },
    recentlyVisitedRanges: [],
    recentlyEditedRanges: recently_edited_ranges,
    isUntitledFile: false,
    completionId: `forge-${Date.now()}`,
  });
  const list = Array.isArray(completions) ? completions : [];
  if (list.length === 0) return "No completions available at this position.";
  return `Suggested completion:\n${list[0]}`;
}

async function handleRunSlashCommand(args: any, core: Core): Promise<string> {
  const { command, input = "", include_unstaged = false } = args;
  if (!command) throw new Error("command is required");

  const streamChat = async (prompt: string): Promise<string> => {
    let result = "";
    for await (const chunk of core.invoke("llm/streamChat", {
      messages: [{ role: "user", content: prompt }],
      title: "",
      completionOptions: {},
    }) as any) {
      if (chunk?.content) result += chunk.content;
    }
    return result || "(no output)";
  };

  if (command === "commit") {
    let diff = "";
    try {
      const { stdout: staged } = await execPromise("git diff --staged");
      const { stdout: unstaged } = await execPromise("git diff");
      diff = include_unstaged
        ? [staged, unstaged].filter(Boolean).join("\n")
        : staged || unstaged;
    } catch {
      throw new Error("No git repository or no changes to commit");
    }
    if (!diff.trim()) return "No changes detected. Nothing to commit.";
    return streamChat(
      `${diff}\n\nGenerate a git commit message for the above changes. ` +
        `First, a single sentence under 80 characters. Then, after 2 blank lines, ` +
        `up to 5 bullet points each under 40 characters. Output only the commit message.`,
    );
  }

  if (command === "review") {
    let diff = "";
    try {
      const { stdout } = await execPromise("git diff HEAD");
      diff = stdout;
    } catch {
      throw new Error("No git repository found");
    }
    return streamChat(
      `Please review the following code changes and provide clear, constructive feedback:\n\n${diff || input}`,
    );
  }

  if (command === "cmd") {
    if (!input) throw new Error("input is required for the 'cmd' command");
    return streamChat(
      `Generate a terminal command to: ${input}\nRespond with only the command, no explanation.`,
    );
  }

  if (command === "onboard") {
    const repoMap = buildRepoTree(process.cwd(), "", 0, 3).join("\n");
    return streamChat(
      `Generate a concise onboarding document for this codebase.\n\nRepository structure:\n${repoMap}\n\nAdditional context: ${input}`,
    );
  }

  if (command === "draftIssue") {
    if (!input) throw new Error("input is required for the 'draftIssue' command");
    return streamChat(
      `Draft a GitHub issue for the following:\n\n${input}\n\n` +
        `Include: Title, Description, Steps to Reproduce (if applicable), Expected Behavior, Actual Behavior.`,
    );
  }

  if (command === "http") {
    if (!input) throw new Error("input is required for the 'http' command");
    return streamChat(
      `Generate a curl command and explain the expected response for:\n${input}`,
    );
  }

  if (command === "share") {
    return `Chat sharing is not available in headless mode. Use forge_history_save to save the session locally.`;
  }

  throw new Error(`Unknown slash command: ${command}`);
}

async function handleCompactConversation(args: any, core: Core): Promise<string> {
  const { history } = args;
  if (!Array.isArray(history) || history.length === 0)
    throw new Error("history must be a non-empty array");
  try {
    const result = await core.invoke("conversation/compact", {
      history: history.map((msg: any) => ({ message: msg })),
    });
    if (result && typeof result === "object") {
      return JSON.stringify(result, null, 2);
    }
  } catch {
    // fall through to LLM summarization
  }
  const convText = history.map((m: any) => `${m.role}: ${m.content}`).join("\n\n");
  let summary = "";
  for await (const chunk of core.invoke("llm/streamChat", {
    messages: [
      {
        role: "user",
        content: `Summarize this conversation concisely, preserving all key decisions, code changes, and context:\n\n${convText}`,
      },
    ],
    title: "",
    completionOptions: {},
  }) as any) {
    if (chunk?.content) summary += chunk.content;
  }
  return summary || "(no summary generated)";
}

async function handleListModels(core: Core): Promise<string> {
  const models = await core.invoke("llm/listModels", undefined);
  const { config } = await core.configHandler.loadConfig();
  const selectedByRole = (config as any)?.selectedModelByRole ?? {};
  return JSON.stringify({ models, selectedByRole }, null, 2);
}

async function handleSwitchModel(args: any, core: Core): Promise<string> {
  const { role, model_title } = args;
  if (!role) throw new Error("role is required");
  if (!model_title) throw new Error("model_title is required");
  const { config } = await core.configHandler.loadConfig();
  const profileId = (config as any)?.selectedProfileId ?? "local";
  await core.invoke("config/updateSelectedModel", { profileId, role, title: model_title });
  return `Successfully set ${role} model to: ${model_title}`;
}

async function handleHistoryList(args: any, core: Core): Promise<string> {
  const limit = args?.limit ?? 20;
  const result = await core.invoke("history/list", { offset: 0, limit });
  return JSON.stringify(result, null, 2);
}

async function handleHistoryLoad(args: any, core: Core): Promise<string> {
  const { session_id } = args;
  if (!session_id) throw new Error("session_id is required");
  const result = await core.invoke("history/load", { id: session_id });
  return JSON.stringify(result, null, 2);
}

async function handleHistorySave(args: any, core: Core): Promise<string> {
  const { session_id, title, history } = args;
  if (!Array.isArray(history)) throw new Error("history must be an array");
  const id = session_id || `forge-${Date.now()}`;
  await core.invoke("history/save", {
    sessionId: id,
    title: title || "Forge Session",
    history: history.map((msg: any, idx: number) => ({
      message: msg,
      contextItems: [],
      promptLogs: [],
      editorState: null,
      index: idx,
    })),
    workspaceDirectory: process.cwd(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return `Session saved with ID: ${id}`;
}

async function handleHistoryDelete(args: any, core: Core): Promise<string> {
  const { session_id } = args;
  if (!session_id) throw new Error("session_id is required");
  await core.invoke("history/delete", { id: session_id });
  return `Session deleted: ${session_id}`;
}

async function handleGetConfig(core: Core): Promise<string> {
  const { config } = await core.configHandler.loadConfig();
  return JSON.stringify(config, null, 2);
}

async function handleAddRule(args: any, core: Core): Promise<string> {
  const { name, rule } = args;
  if (!name) throw new Error("name is required");
  if (!rule) throw new Error("rule is required");
  const rulesDir = path.join(
    process.env.HOME || process.env.USERPROFILE || process.cwd(),
    ".continue",
    "rules",
  );
  if (!fs.existsSync(rulesDir)) fs.mkdirSync(rulesDir, { recursive: true });
  const filename = `${name.replace(/[^a-z0-9-]/gi, "-")}.md`;
  const filepath = path.join(rulesDir, filename);
  fs.writeFileSync(filepath, `# ${name}\n\n${rule}\n`, "utf-8");
  try {
    await core.invoke("config/addGlobalRule", { baseFilename: name });
  } catch {
    await core.configHandler.reloadConfig("Rule added via Forge");
  }
  return `Rule created: ${filepath}`;
}

async function handleDeleteRule(args: any, core: Core): Promise<string> {
  const { filepath } = args;
  if (!filepath) throw new Error("filepath is required");
  if (!fs.existsSync(filepath)) throw new Error(`Rule file not found: ${filepath}`);
  try {
    await core.invoke("config/deleteRule", { filepath });
    return `Rule deleted: ${filepath}`;
  } catch {
    fs.unlinkSync(filepath);
    return `Rule file deleted: ${filepath}`;
  }
}

async function handleAddModel(args: any, core: Core): Promise<string> {
  const { provider, model, title, role = "chat", api_key, api_base } = args;
  if (!provider) throw new Error("provider is required");
  if (!model) throw new Error("model is required");
  const modelConfig: Record<string, any> = { provider, model, title: title || model };
  if (api_key) modelConfig.apiKey = api_key;
  if (api_base) modelConfig.apiBase = api_base;
  await core.invoke("config/addModel", { model: modelConfig, role });
  return `Added model "${title || model}" (${provider}) for role: ${role}`;
}

async function handleDeleteModel(args: any, core: Core): Promise<string> {
  const { title } = args;
  if (!title) throw new Error("title is required");
  await core.invoke("config/deleteModel", { title });
  return `Deleted model: ${title}`;
}

async function handleIndexCodebase(args: any, core: Core): Promise<string> {
  const { action } = args;
  if (action === "trigger") {
    await core.invoke("index/forceReIndex", { shouldClearIndexes: false });
    return "Codebase indexing triggered. Use action='status' to check progress.";
  }
  return JSON.stringify({
    status: "idle",
    note: "Use action='trigger' to start indexing. Live status requires an active IDE session.",
  });
}

async function handleAddDocs(args: any, core: Core): Promise<string> {
  const { start_url, title } = args;
  if (!start_url) throw new Error("start_url is required");
  await core.invoke("context/addDocs", { startUrl: start_url, title });
  return `Documentation source added: ${start_url}. Indexing started in the background.`;
}

async function handleRemoveDocs(args: any, core: Core): Promise<string> {
  const { start_url } = args;
  if (!start_url) throw new Error("start_url is required");
  await core.invoke("context/removeDocs", { startUrl: start_url });
  return `Documentation source removed: ${start_url}`;
}

async function handleContextRetrieval(args: any, core: Core): Promise<string> {
  const { name, query, full_input } = args;
  if (!name) throw new Error("name is required");
  if (!query) throw new Error("query is required");
  const result = await core.invoke("context/getContextItems", {
    name,
    query,
    fullInput: full_input || query,
    selectedCode: [],
    isInAgentMode: false,
  });
  return JSON.stringify(result, null, 2);
}

async function handleGetTokenStats(args: any, core: Core): Promise<string> {
  const { group_by = "both" } = args;
  const results: Record<string, any> = {};
  if (group_by === "day" || group_by === "both") {
    try {
      results.byDay = await core.invoke("stats/getTokensPerDay", undefined);
    } catch {
      results.byDay = [];
    }
  }
  if (group_by === "model" || group_by === "both") {
    try {
      results.byModel = await core.invoke("stats/getTokensPerModel", undefined);
    } catch {
      results.byModel = [];
    }
  }
  return JSON.stringify(results, null, 2);
}

// ===========================================================================
// REGISTER ALL TOOLS ON THE MCP SERVER
// ===========================================================================

export function registerTools(server: Server, core: Core): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    async function run(): Promise<string> {
      switch (name) {
        // Filesystem
        case "read_file":       return handleReadFile(args);
        case "read_file_range": return handleReadFileRange(args);
        case "write_file":      return handleWriteFile(args);
        case "create_file":     return handleCreateFile(args);
        case "edit_file":       return handleEditFile(args);
        case "multi_edit_file": return handleMultiEditFile(args);
        case "list_dir":        return handleListDir(args);
        // Search
        case "glob_search":  return handleGlobSearch(args);
        case "search_code":  return handleSearchCode(args);
        // Shell
        case "bash": return handleBash(args);
        // Network
        case "fetch_url": return handleFetchUrl(args);
        // Git
        case "view_diff":     return handleViewDiff(args);
        case "view_repo_map": return handleViewRepoMap(args);
        // AI / LLM
        case "forge_chat":                 return handleForgeChat(args, core);
        case "forge_autocomplete":         return handleForgeAutocomplete(args, core);
        case "forge_run_slash_command":    return handleRunSlashCommand(args, core);
        case "forge_compact_conversation": return handleCompactConversation(args, core);
        // Models
        case "forge_list_models":  return handleListModels(core);
        case "forge_switch_model": return handleSwitchModel(args, core);
        // History
        case "forge_history_list":   return handleHistoryList(args, core);
        case "forge_history_load":   return handleHistoryLoad(args, core);
        case "forge_history_save":   return handleHistorySave(args, core);
        case "forge_history_delete": return handleHistoryDelete(args, core);
        // Config
        case "forge_get_config":   return handleGetConfig(core);
        case "forge_add_rule":     return handleAddRule(args, core);
        case "forge_delete_rule":  return handleDeleteRule(args, core);
        case "forge_add_model":    return handleAddModel(args, core);
        case "forge_delete_model": return handleDeleteModel(args, core);
        // Indexing / Docs
        case "forge_index_codebase": return handleIndexCodebase(args, core);
        case "forge_add_docs":       return handleAddDocs(args, core);
        case "forge_remove_docs":    return handleRemoveDocs(args, core);
        // Context
        case "forge_context_retrieval": return handleContextRetrieval(args, core);
        // Stats
        case "forge_get_token_stats": return handleGetTokenStats(args, core);

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    }

    try {
      const text = await run();
      return { content: [{ type: "text", text }] };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: `Error: ${error.message ?? String(error)}` }],
        isError: true,
      };
    }
  });
}
