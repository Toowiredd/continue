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
// Session-level read tracking (required for edit safety — must read before edit)
// ---------------------------------------------------------------------------
const readFilesSet = new Set<string>();

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
// Inline find-and-replace (no deep core dep chain required)
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
      `String "${oldStr}" appears ${occurrences} times. Provide more surrounding context to make it unique, or use replace_all=true.`,
    );
  }
  return replaceAll
    ? content.split(oldStr).join(newStr)
    : content.replace(oldStr, newStr);
}

// ---------------------------------------------------------------------------
// Diff generation
// ---------------------------------------------------------------------------
function generateUnifiedDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
  ];
  // Simple unified diff — show all changes with 3 lines context
  let i = 0;
  let j = 0;
  while (i < oldLines.length || j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      lines.push(` ${oldLines[i] ?? ""}`);
      i++;
      j++;
    } else {
      const hunkStart = lines.length;
      const hunkLines: string[] = [];
      while (i < oldLines.length && oldLines[i] !== newLines[j]) {
        hunkLines.push(`-${oldLines[i++]}`);
      }
      while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
        hunkLines.push(`+${newLines[j++]}`);
      }
      lines.push(...hunkLines);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Output truncation helpers
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
// Gitignore helpers for code search
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
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  // ── Filesystem: Read ───────────────────────────────────────────────────
  {
    name: "read_file",
    description:
      "Read the full contents of a file. Must be called before edit_file or multi_edit_file.",
    inputSchema: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
      },
    },
  },

  // ── Filesystem: Write ──────────────────────────────────────────────────
  {
    name: "write_file",
    description:
      "Write (or create) a file with the given content. Creates parent directories automatically.",
    inputSchema: {
      type: "object",
      required: ["filepath", "content"],
      properties: {
        filepath: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        content: {
          type: "string",
          description: "Full file content to write",
        },
      },
    },
  },

  // ── Filesystem: Edit (find-and-replace) ───────────────────────────────
  {
    name: "edit_file",
    description: `Perform an exact string replacement in an existing file.
IMPORTANT: You must call read_file for this file before calling edit_file.
- old_string must match file contents exactly (including whitespace/indentation).
- Set replace_all=true to replace every occurrence; otherwise fails if the string appears more than once.`,
    inputSchema: {
      type: "object",
      required: ["filepath", "old_string", "new_string"],
      properties: {
        filepath: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
        old_string: {
          type: "string",
          description: "The exact text to replace",
        },
        new_string: {
          type: "string",
          description: "The replacement text",
        },
        replace_all: {
          type: "boolean",
          description: "Replace all occurrences (default false)",
        },
      },
    },
  },

  // ── Filesystem: Multi-edit (multiple find-and-replace) ────────────────
  {
    name: "multi_edit_file",
    description: `Perform multiple exact string replacements in a single file in one call.
All edits are applied sequentially — each operates on the result of the previous.
IMPORTANT: You must call read_file for this file before calling multi_edit_file.`,
    inputSchema: {
      type: "object",
      required: ["filepath", "edits"],
      properties: {
        filepath: {
          type: "string",
          description: "Absolute or relative path to the file",
        },
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

  // ── Filesystem: List directory ─────────────────────────────────────────
  {
    name: "list_dir",
    description: "List files and subdirectories in a directory.",
    inputSchema: {
      type: "object",
      required: ["dirpath"],
      properties: {
        dirpath: {
          type: "string",
          description: "Path to the directory (defaults to cwd)",
        },
      },
    },
  },

  // ── Filesystem: Glob search ────────────────────────────────────────────
  {
    name: "glob_search",
    description:
      "Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.{js,jsx}').",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern to match files against",
        },
        cwd: {
          type: "string",
          description: "Directory to search from (defaults to process.cwd())",
        },
      },
    },
  },

  // ── Code search (ripgrep / grep) ───────────────────────────────────────
  {
    name: "search_code",
    description:
      "Search the codebase for a text pattern using ripgrep (falls back to grep). Returns file path, line number and matched line.",
    inputSchema: {
      type: "object",
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Regex or literal search pattern",
        },
        path: {
          type: "string",
          description: "Directory or file to search (defaults to cwd)",
        },
        file_pattern: {
          type: "string",
          description: "Glob to filter files, e.g. '*.ts'",
        },
        case_sensitive: {
          type: "boolean",
          description: "Case-sensitive search (default false — case-insensitive)",
        },
      },
    },
  },

  // ── Bash / Terminal ────────────────────────────────────────────────────
  {
    name: "bash",
    description: `Execute a shell command and return stdout/stderr.
Commands run from: ${process.cwd()}
- Prefer read_file/write_file/edit_file for file operations instead of sed/awk.
- Use timeout (seconds) for long-running commands (max 600s).`,
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description: "The shell command to run",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 120, max 600)",
        },
        cwd: {
          type: "string",
          description: "Working directory for the command",
        },
      },
    },
  },

  // ── Fetch URL ─────────────────────────────────────────────────────────
  {
    name: "fetch_url",
    description:
      "Fetch a URL and return its content converted to Markdown. Useful for reading documentation, issues, or any web page.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
      },
    },
  },

  // ── Git diff ──────────────────────────────────────────────────────────
  {
    name: "view_diff",
    description:
      "Show all uncommitted changes in the git repository (git diff + git diff --staged).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to the git repo (defaults to cwd)",
        },
        staged: {
          type: "boolean",
          description:
            "Show staged changes only (default false — shows both staged and unstaged)",
        },
      },
    },
  },

  // ── Repository map ────────────────────────────────────────────────────
  {
    name: "view_repo_map",
    description:
      "Show the file/directory structure of the repository as a tree. Useful for navigation and orientation.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Root directory to map (defaults to cwd)",
        },
        max_depth: {
          type: "number",
          description: "Maximum directory depth to show (default 4)",
        },
      },
    },
  },

  // ── Continue: Chat with LLM ──────────────────────────────────────────
  {
    name: "continue_chat",
    description:
      "Send a multi-turn conversation to the configured LLM (from ~/.continue/config.yaml) and return the assistant reply. Use for code review, explanations, planning, etc.",
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
          description: "Model title from config to use (uses default if omitted)",
        },
      },
    },
  },

  // ── Continue: Get config ──────────────────────────────────────────────
  {
    name: "continue_get_config",
    description:
      "Return the fully-resolved Continue config (all models, context providers, slash commands, MCP servers, rules, etc.).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ── Continue: Codebase indexing ───────────────────────────────────────
  {
    name: "continue_index_codebase",
    description:
      "Trigger or query status of the Continue codebase semantic-search index.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: {
          type: "string",
          enum: ["trigger", "status"],
          description: "'trigger' starts (re-)indexing; 'status' returns current progress",
        },
      },
    },
  },

  // ── Continue: Context retrieval ───────────────────────────────────────
  {
    name: "continue_context_retrieval",
    description:
      "Run a named Continue context provider (codebase, docs, web, file, git-diff, terminal, etc.) and return ranked context items.",
    inputSchema: {
      type: "object",
      required: ["name", "query"],
      properties: {
        name: {
          type: "string",
          description: "Context provider name (e.g. 'codebase', 'docs', 'web', 'file', 'diff', 'terminal')",
        },
        query: {
          type: "string",
          description: "Query or input for the context provider",
        },
        full_input: {
          type: "string",
          description: "Full user input (optional, defaults to query)",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handler implementations
// ---------------------------------------------------------------------------

async function handleReadFile(args: any): Promise<string> {
  const { filepath } = args;
  if (!filepath) throw new Error("filepath is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, "utf-8");
  const MAX_READ_CHARS = 100_000;
  const lineCount = content.split("\n").length;
  if (content.length > MAX_READ_CHARS) {
    throw new Error(
      `File too large to read (${content.length.toLocaleString()} chars, ${lineCount.toLocaleString()} lines). ` +
        `Max: ${MAX_READ_CHARS.toLocaleString()} chars. Use bash with head/tail/sed to read targeted sections.`,
    );
  }
  readFilesSet.add(resolved);
  return `Content of ${resolved}:\n${content}`;
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
  return existed
    ? `File unchanged: ${resolved}`
    : `Successfully created ${resolved}`;
}

async function handleEditFile(args: any): Promise<string> {
  const { filepath, old_string, new_string, replace_all = false } = args;
  if (!filepath) throw new Error("filepath is required");
  const resolved = path.resolve(process.cwd(), filepath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  if (!readFilesSet.has(resolved)) {
    throw new Error(
      `You must call read_file on "${filepath}" before editing it.`,
    );
  }
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
  if (!readFilesSet.has(resolved)) {
    throw new Error(
      `You must call read_file on "${filepath}" before editing it.`,
    );
  }
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
  const dirpath = args.dirpath
    ? path.resolve(process.cwd(), args.dirpath)
    : process.cwd();
  if (!fs.existsSync(dirpath))
    throw new Error(`Directory not found: ${dirpath}`);
  const entries = fs.readdirSync(dirpath, { withFileTypes: true });
  const lines = entries.map((e) => {
    const type = e.isDirectory() ? "dir " : "file";
    const fullPath = path.join(dirpath, e.name);
    const size = e.isFile()
      ? ` (${fs.statSync(fullPath).size.toLocaleString()} bytes)`
      : "";
    return `${type}  ${e.name}${size}`;
  });
  return `Contents of ${dirpath}:\n${lines.join("\n")}`;
}

async function handleGlobSearch(args: any): Promise<string> {
  const { pattern, cwd: cwdArg } = args;
  if (!pattern) throw new Error("pattern is required");
  const searchCwd = cwdArg ? path.resolve(cwdArg) : process.cwd();
  // Use find or PowerShell for glob matching
  let command: string;
  if (process.platform === "win32") {
    command = `Get-ChildItem -Recurse -Path "${searchCwd}" -Filter "${pattern}" | Select-Object -ExpandProperty FullName`;
  } else {
    // Convert glob to find-friendly expression (approximate)
    const rg = await checkRipgrepAvailable();
    if (rg) {
      command = `rg --files "${searchCwd}" -g "${pattern}"`;
    } else {
      command = `find "${searchCwd}" -type f -name "${pattern.replace("**/", "")}"`;
    }
  }
  try {
    const { stdout } = await execPromise(command);
    const files = stdout.trim().split("\n").filter(Boolean);
    if (files.length === 0) return `No files match pattern: ${pattern}`;
    const limited = files.slice(0, 500);
    const note =
      files.length > 500 ? `\n[Showing 500 of ${files.length} matches]` : "";
    return `Files matching "${pattern}":\n${limited.join("\n")}${note}`;
  } catch (e: any) {
    if (e.code === 1) return `No files match pattern: ${pattern}`;
    throw new Error(`Glob search failed: ${e.message}`);
  }
}

async function handleSearchCode(args: any): Promise<string> {
  const { pattern, path: searchPath, file_pattern, case_sensitive = false } = args;
  if (!pattern) throw new Error("pattern is required");
  const target = searchPath
    ? path.resolve(process.cwd(), searchPath)
    : process.cwd();
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
      let excludeArgs = ignorePatterns
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

  if (!stdout.trim())
    return `No matches found for pattern "${pattern}"${file_pattern ? ` in files matching "${file_pattern}"` : ""}.`;

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
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill();
      resolve(
        truncate(stdout + (stderr ? `\nStderr: ${stderr}` : "")) +
          `\n[Timed out after ${timeoutSecs ?? 120}s]`,
      );
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      if (code !== 0 && stderr) {
        reject(new Error(`Exit code ${code}: ${stderr}`));
        return;
      }
      const output = stdout + (stderr ? `\nStderr: ${stderr}` : "");
      resolve(truncate(output) || "(no output)");
    });
    child.on("error", (e) => {
      if (resolved) return;
      resolved = true;
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

    // Simple HTML → text conversion (strip tags)
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
  const cmds = staged
    ? ["git diff --staged"]
    : ["git diff", "git diff --staged"];
  const parts: string[] = [];
  for (const cmd of cmds) {
    const { stdout } = await execPromise(cmd, { cwd });
    if (stdout.trim()) parts.push(stdout);
  }
  if (parts.length === 0) return "No changes in the repository.";
  return truncate(parts.join("\n\n"), 50_000);
}

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
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? prefix + "    " : prefix + "│   ";
    if (e.isDirectory()) {
      return [
        `${prefix}${connector}${e.name}/`,
        ...buildRepoTree(
          path.join(dir, e.name),
          childPrefix,
          depth + 1,
          maxDepth,
        ),
      ];
    }
    return [`${prefix}${connector}${e.name}`];
  });
}

async function handleViewRepoMap(args: any): Promise<string> {
  const { path: repoPath, max_depth = 4 } = args;
  const root = repoPath ? path.resolve(repoPath) : process.cwd();
  if (!fs.existsSync(root)) throw new Error(`Path not found: ${root}`);
  const lines = [root, ...buildRepoTree(root, "", 0, max_depth)];
  return truncate(lines.join("\n"), 30_000);
}

async function handleContinueChat(args: any, core: Core): Promise<string> {
  const { messages, model } = args;
  if (!Array.isArray(messages) || messages.length === 0)
    throw new Error("messages must be a non-empty array");
  let resultStr = "";
  for await (const chunk of core.invoke("llm/streamChat", {
    messages,
    title: model || "",
    completionOptions: {},
  }) as any) {
    if (chunk?.content) resultStr += chunk.content;
  }
  return resultStr || "(no response)";
}

async function handleContinueGetConfig(core: Core): Promise<string> {
  const { config } = await core.configHandler.loadConfig();
  return JSON.stringify(config, null, 2);
}

async function handleContinueIndexCodebase(
  args: any,
  core: Core,
): Promise<string> {
  const { action } = args;
  if (action === "trigger") {
    await core.invoke("index/forceReIndex", { shouldClearIndexes: false });
    return "Codebase indexing triggered.";
  } else {
    // Status is not directly exposed by Core without a listener;
    // trigger a status-check and return a best-effort response.
    return JSON.stringify({ status: "idle", note: "Use action=trigger to start indexing" });
  }
}

async function handleContinueContextRetrieval(
  args: any,
  core: Core,
): Promise<string> {
  const { name, query, full_input } = args;
  const result = await core.invoke("context/getContextItems", {
    name,
    query,
    fullInput: full_input || query,
    selectedCode: [],
    isInAgentMode: false,
  });
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// Register all tools on the MCP server
// ---------------------------------------------------------------------------

export function registerTools(server: Server, core: Core): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    async function run(): Promise<string> {
      switch (name) {
        case "read_file":
          return handleReadFile(args);
        case "write_file":
          return handleWriteFile(args);
        case "edit_file":
          return handleEditFile(args);
        case "multi_edit_file":
          return handleMultiEditFile(args);
        case "list_dir":
          return handleListDir(args);
        case "glob_search":
          return handleGlobSearch(args);
        case "search_code":
          return handleSearchCode(args);
        case "bash":
          return handleBash(args);
        case "fetch_url":
          return handleFetchUrl(args);
        case "view_diff":
          return handleViewDiff(args);
        case "view_repo_map":
          return handleViewRepoMap(args);
        case "continue_chat":
          return handleContinueChat(args, core);
        case "continue_get_config":
          return handleContinueGetConfig(core);
        case "continue_index_codebase":
          return handleContinueIndexCodebase(args, core);
        case "continue_context_retrieval":
          return handleContinueContextRetrieval(args, core);
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

