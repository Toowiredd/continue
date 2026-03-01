import { ContinueMcpServer } from "../index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Mock core fully so we don't try to load its complex dependencies
jest.mock("core/core", () => {
  return {
    Core: jest.fn().mockImplementation(() => {
      return {
        invoke: jest.fn().mockImplementation((command: string) => {
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
  });

  it("should initialize the server", () => {
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
    expect(server.server).toBeInstanceOf(Server);
  });

});
