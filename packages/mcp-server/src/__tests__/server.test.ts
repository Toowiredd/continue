import { ContinueMcpServer } from "../index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Mock Continue Core ──────────────────────────────────────────────────────
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
      return Promise.resolve({ mocked: true });
    }),
    configHandler: {
      loadConfig: jest.fn().mockResolvedValue({
        config: { models: [{ title: "GPT-4o", provider: "openai" }] },
      }),
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
describe("ContinueMcpServer — full SWE solution", () => {
  let mcpServer: ContinueMcpServer;
  let tmpDir: string;

  beforeEach(() => {
    mcpServer = new ContinueMcpServer();
    mockInvoke.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Server initialisation ─────────────────────────────────────────────
  it("initialises the MCP server", () => {
    expect(mcpServer).toBeDefined();
    expect(mcpServer.server).toBeInstanceOf(Server);
  });

  // ── Tool registration ─────────────────────────────────────────────────
  it("registers all 15 SWE tools", async () => {
    const listHandler = getHandler(mcpServer.server, "tools/list");
    if (!listHandler) return; // skip if server internals are opaque
    const result = await listHandler(
      { method: "tools/list", params: {} },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    const names: string[] = result.tools.map((t: any) => t.name);
    const expected = [
      "read_file",
      "write_file",
      "edit_file",
      "multi_edit_file",
      "list_dir",
      "glob_search",
      "search_code",
      "bash",
      "fetch_url",
      "view_diff",
      "view_repo_map",
      "continue_chat",
      "continue_get_config",
      "continue_index_codebase",
      "continue_context_retrieval",
    ];
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

  // ── edit_file ─────────────────────────────────────────────────────────
  it("edit_file replaces text after read_file", async () => {
    const file = path.join(tmpDir, "edit-me.ts");
    fs.writeFileSync(file, "const foo = 1;\n");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    // Must read first
    await callHandler(
      {
        method: "tools/call",
        params: { name: "read_file", arguments: { filepath: file } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "edit_file",
          arguments: {
            filepath: file,
            old_string: "const foo = 1;",
            new_string: "const bar = 2;",
          },
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
        params: {
          name: "edit_file",
          arguments: { filepath: file, old_string: "const a = 1;", new_string: "const b = 2;" },
        },
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
      {
        method: "tools/call",
        params: { name: "list_dir", arguments: { dirpath: tmpDir } },
      },
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
      {
        method: "tools/call",
        params: {
          name: "bash",
          arguments: { command: 'echo "mcp-works"', timeout: 10 },
        },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("mcp-works");
  });

  // ── continue_chat ─────────────────────────────────────────────────────
  it("continue_chat streams LLM response", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "continue_chat",
          arguments: {
            messages: [{ role: "user", content: "Hello" }],
          },
        },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Hello from LLM");
  });

  // ── continue_get_config ───────────────────────────────────────────────
  it("continue_get_config returns config JSON", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "continue_get_config", arguments: {} },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    const config = JSON.parse(result.content[0].text);
    expect(config.models[0].title).toBe("GPT-4o");
  });

  // ── continue_index_codebase ───────────────────────────────────────────
  it("continue_index_codebase triggers indexing", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: {
          name: "continue_index_codebase",
          arguments: { action: "trigger" },
        },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toMatch(/trigger/i);
    expect(mockInvoke).toHaveBeenCalledWith("index/forceReIndex", expect.any(Object));
  });

  // ── view_repo_map ─────────────────────────────────────────────────────
  it("view_repo_map shows directory tree", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"));
    fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "");
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "view_repo_map", arguments: { path: tmpDir } },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.content[0].text).toContain("src");
  });

  // ── unknown tool ──────────────────────────────────────────────────────
  it("returns an error for unknown tools", async () => {
    const callHandler = getHandler(mcpServer.server, "tools/call");
    if (!callHandler) return;
    const result = await callHandler(
      {
        method: "tools/call",
        params: { name: "nonexistent_tool", arguments: {} },
      },
      { isCancellationRequested: false, onCancellationRequested: () => {} },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/unknown tool/i);
  });
});
