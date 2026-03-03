import { ContinueMcpServer } from "../index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const mockInvoke = jest.fn();
jest.mock("core/core", () => {
  return {
    Core: jest.fn().mockImplementation(() => {
      return {
        invoke: mockInvoke.mockImplementation((command: string) => {
          if (command === "autocomplete/complete") return Promise.resolve({ completed: true });
          if (command === "context/getContextItems") return Promise.resolve([{ name: "test", description: "test context" }]);
          if (command === "index/forceReIndex") return Promise.resolve();
          if (command === "llm/streamChat") {
            return (async function* () { yield { content: "chat response" }; })();
          }
          if (command === "mcp/getPrompt") return Promise.resolve({ text: "prompt text" });
          return Promise.resolve({ mocked: true });
        }),
        configHandler: {
          loadConfig: jest.fn().mockResolvedValue({ config: { models: [] } })
        }
      };
    })
  };
});

jest.mock("core/protocol/messenger", () => {
  return {
    InProcessMessenger: jest.fn().mockImplementation(() => {})
  };
});

jest.mock("../headlessIde", () => {
  return {
    HeadlessIDE: jest.fn().mockImplementation(() => {})
  };
});

describe("ContinueMcpServer", () => {
  let server: ContinueMcpServer;

  beforeEach(() => {
    server = new ContinueMcpServer();
    mockInvoke.mockClear();
  });

  it("should initialize the server", () => {
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
    expect(server.server).toBeInstanceOf(Server);
  });

  it("should expose tools with valid schemas", async () => {
    const requestHandlers = (server.server as any)._requestHandlers || (server.server as any).requestHandlers;
    let listHandler: any;
    for (const [key, value] of requestHandlers.entries ? requestHandlers.entries() : Object.entries(requestHandlers)) {
        if (key === "tools/list" || (key && (key as any).method === "tools/list")) listHandler = value;
    }

    if (!listHandler && requestHandlers.get) {
        listHandler = requestHandlers.get("tools/list");
    } else if (!listHandler) {
        listHandler = requestHandlers["tools/list"];
    }

    if (listHandler) {
      const result = await listHandler({ method: "tools/list", params: {} }, { isCancellationRequested: false, onCancellationRequested: () => {} });
      expect(result.tools.length).toBe(7);
      const names = result.tools.map((t: any) => t.name);
      expect(names).toContain("continue_autocomplete");
      expect(names).toContain("continue_chat");
      const chatTool = result.tools.find((t: any) => t.name === "continue_chat");
      expect(chatTool.inputSchema.properties).toHaveProperty("messages");
    }
  });

  it("should invoke core functionality when calling tools", async () => {
    const requestHandlers = (server.server as any)._requestHandlers || (server.server as any).requestHandlers;
    let callHandler: any;
    if (requestHandlers.get) {
        callHandler = requestHandlers.get("tools/call");
    } else {
        callHandler = requestHandlers["tools/call"];
    }

    if (!callHandler) {
       for (const [key, value] of requestHandlers.entries ? requestHandlers.entries() : Object.entries(requestHandlers)) {
          if (key === "tools/call" || (key && (key as any).method === "tools/call")) callHandler = value;
      }
    }

    if (callHandler) {
      const result = await callHandler({
        method: "tools/call",
        params: {
          name: "continue_autocomplete",
          arguments: {
            filepath: "test.ts",
            pos: { line: 0, character: 0 },
            recentlyVisitedRanges: [],
            recentlyEditedRanges: [],
            gitOperations: ""
          }
        }
      }, { isCancellationRequested: false, onCancellationRequested: () => {} });

      expect(result.content[0].text).toContain("completed");
      expect(mockInvoke).toHaveBeenCalledWith("autocomplete/complete", expect.any(Object));
    }
  });

});
