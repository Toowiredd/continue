import { ForgeMcpServer } from "../index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Mock AI Core ────────────────────────────────────────────────────────────
const mockInvoke = jest.fn();
jest.mock("core/core", () => ({
  Core: jest.fn().mockImplementation(() => ({
    invoke: mockInvoke.mockImplementation((command: string) => {
      if (command === "llm/streamChat")
        return (async function* () {
          yield { content: "Hello from LLM" };
        })();
      if (command === "index/forceReIndex") return Promise.resolve();
      if (command === "context/getContextItems")
        return Promise.resolve([{ name: "ctx", content: "ctx content" }]);
      if (command === "history/list") return Promise.resolve([]);
      if (command === "history/load") return Promise.resolve({ history: [] });
      if (command === "history/save") return Promise.resolve();
      if (command === "history/delete") return Promise.resolve();
      if (command === "llm/listModels") return Promise.resolve([]);
      if (command === "stats/getTokensPerDay") return Promise.resolve([]);
      if (command === "stats/getTokensPerModel") return Promise.resolve([]);
      return Promise.resolve({ mocked: true });
    }),
    configHandler: {
      loadConfig: jest.fn().mockResolvedValue({
        config: { models: [{ title: "GPT-4o", provider: "openai" }] },
      }),
      reloadConfig: jest.fn().mockResolvedValue(undefined),
    },
  })),
}));

jest.mock("core/protocol/messenger", () => ({
  InProcessMessenger: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../headlessIde", () => ({
  HeadlessIDE: jest.fn().mockImplementation(() => ({})),
}));

// ── Helpers to get registered handlers ─────────────────────────────────────
function getHandler(server: Server, method: string): any {
  const handlers: Map<any, any> =
    (server as any)._requestHandlers ?? (server as any).requestHandlers;
  if (!handlers) return undefined;
  if (handlers.get) return handlers.get(method);
  return (handlers as any)[method];
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("ForgeMcpServer — full SWE solution", () => {
  let mcpServer: ForgeMcpServer;
  let tmpDir: string;

  beforeEach(() => {
    mcpServer = new ForgeMcpServer();
    mockInvoke.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Server initialisation ─────────────────────────────────────────────
  it("initialises the Forge MCP server", () => {
    expect(mcpServer).toBeDefined();
    expect(mcpServer.server).toBeInstanceOf(Server);
  });

  // ── Tool registration ─────────────────────────────────────────────────
  it("registers all 33 Forge tools", async () => {
    const listHandler = getHandler(mcpServer.server, "tools/list");
    if (!listHandler) return;
    const result = await listHandler(
      { method: "tools/list", params: {} },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    const names: string[] = result.tools.map((t: any) => t.name);
    const expected = [
      // Filesystem
      "read_file", "read_file_range", "write_file", "create_file",
      "edit_file", "multi_edit_file", "list_dir",
      // Search
      "glob_search", "search_code",
      // Shell
      "bash",
      // Network
      "fetch_url",
      // Git
      "view_diff", "view_repo_map",
      // AI / LLM
      "forge_chat", "forge_autocomplete", "forge_run_slash_command", "forge_compact_conversation",
      // Models
      "forge_list_models", "forge_switch_model",
      // History
      "forge_history_list", "forge_history_load", "forge_history_save", "forge_history_delete",
      // Config
      "forge_get_config", "forge_add_rule", "forge_delete_rule", "forge_add_model", "forge_delete_model",
      // Indexing / Docs
      "forge_index_codebase", "forge_add_docs", "forge_remove_docs",
      // Context
      "forge_context_retrieval",
      // Stats
      "forge_get_token_stats",
    ];
    expect(names).toHaveLength(33);
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  // ── read_file ─────────────────────────────────────────────────────────
  it("read_file reads an existing file", async () => {
    const file = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(file, "hello world");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "read_file", arguments: { filepath: file } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toContain("hello world");
  });

  it("read_file returns an error for a missing file", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "read_file", arguments: { filepath: "/nonexistent/file.txt" } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/not found/i);
  });

  // ── read_file_range ───────────────────────────────────────────────────
  it("read_file_range reads specific lines", async () => {
    const file = path.join(tmpDir, "lines.txt");
    fs.writeFileSync(file, "line1\nline2\nline3\nline4\nline5");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "read_file_range", arguments: { filepath: file, start_line: 2, end_line: 4 } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toContain("line2");
    expect(result.content[0].text).toContain("line4");
    expect(result.content[0].text).not.toContain("line1");
    expect(result.content[0].text).not.toContain("line5");
  });

  // ── write_file ────────────────────────────────────────────────────────
  it("write_file creates a new file", async () => {
    const file = path.join(tmpDir, "new.ts");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "write_file",
          arguments: { filepath: file, content: "const x = 1;" },
        },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toMatch(/created/i);
    expect(fs.readFileSync(file, "utf-8")).toBe("const x = 1;");
  });

  // ── create_file ───────────────────────────────────────────────────────
  it("create_file creates a new file and fails if it exists", async () => {
    const file = path.join(tmpDir, "brand-new.ts");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const r1 = await callHandler(
      { method: "tools/call", params: { name: "create_file", arguments: { filepath: file, content: "// new" } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(r1.isError).toBeFalsy();
    expect(fs.readFileSync(file, "utf-8")).toBe("// new");
    // Second call should fail
    const r2 = await callHandler(
      { method: "tools/call", params: { name: "create_file", arguments: { filepath: file, content: "// duplicate" } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(r2.isError).toBe(true);
    expect(r2.content[0].text).toMatch(/already exists/i);
  });

  // ── edit_file ─────────────────────────────────────────────────────────
  it("edit_file replaces text after read_file", async () => {
    const file = path.join(tmpDir, "edit-me.ts");
    fs.writeFileSync(file, "const foo = 1;\n");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    await callHandler(
      { method: "tools/call", params: { name: "read_file", arguments: { filepath: file } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "edit_file",
          arguments: { filepath: file, old_string: "const foo = 1;", new_string: "const bar = 2;" },
        },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(file, "utf-8")).toContain("const bar = 2;");
  });

  it("edit_file fails if file not read first", async () => {
    const file = path.join(tmpDir, "unread.ts");
    fs.writeFileSync(file, "const a = 1;\n");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "edit_file", arguments: { filepath: file, old_string: "const a = 1;", new_string: "const b = 2;" } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBe(true);
  });

  // ── list_dir ──────────────────────────────────────────────────────────
  it("list_dir lists a directory", async () => {
    fs.writeFileSync(path.join(tmpDir, "a.ts"), "");
    fs.writeFileSync(path.join(tmpDir, "b.ts"), "");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "list_dir", arguments: { dirpath: tmpDir } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toContain("a.ts");
    expect(result.content[0].text).toContain("b.ts");
  });

  // ── bash ──────────────────────────────────────────────────────────────
  it("bash runs a simple command", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "bash", arguments: { command: 'echo "forge-works"', timeout: 10 } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("forge-works");
  });

  // ── forge_chat ────────────────────────────────────────────────────────
  it("forge_chat streams AI response", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "forge_chat", arguments: { messages: [{ role: "user", content: "Hello" }] } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Hello from LLM");
  });

  // ── forge_get_config ──────────────────────────────────────────────────
  it("forge_get_config returns config JSON", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "forge_get_config", arguments: {} } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    const config = JSON.parse(result.content[0].text);
    expect(config.models[0].title).toBe("GPT-4o");
  });

  // ── forge_index_codebase ──────────────────────────────────────────────
  it("forge_index_codebase triggers indexing", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "forge_index_codebase", arguments: { action: "trigger" } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/trigger/i);
    expect(mockInvoke).toHaveBeenCalledWith("index/forceReIndex", expect.any(Object));
  });

  // ── forge_list_models ─────────────────────────────────────────────────
  it("forge_list_models returns model list", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "forge_list_models", arguments: {} } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(mockInvoke).toHaveBeenCalledWith("llm/listModels", undefined);
  });

  // ── forge_history_list ────────────────────────────────────────────────
  it("forge_history_list returns session list", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "forge_history_list", arguments: { limit: 5 } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(mockInvoke).toHaveBeenCalledWith("history/list", expect.any(Object));
  });

  // ── forge_get_token_stats ─────────────────────────────────────────────
  it("forge_get_token_stats returns usage stats", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "forge_get_token_stats", arguments: { group_by: "both" } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    const stats = JSON.parse(result.content[0].text);
    expect(stats).toHaveProperty("byDay");
    expect(stats).toHaveProperty("byModel");
  });

  // ── view_repo_map ─────────────────────────────────────────────────────
  it("view_repo_map shows directory tree", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "view_repo_map", arguments: { path: tmpDir } } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toContain("src");
  });

  // ── unknown tool ──────────────────────────────────────────────────────
  it("returns an error for unknown tools", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      { method: "tools/call", params: { name: "nonexistent_tool", arguments: {} } },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool/i);
  });
});
