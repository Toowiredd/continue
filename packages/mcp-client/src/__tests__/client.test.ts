import { ContinueMcpClient } from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// We mock the connect method to avoid actually opening a transport during basic tests
jest.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: jest.fn().mockImplementation(() => {
      return {
        connect: jest.fn().mockResolvedValue(undefined),
        request: jest.fn().mockImplementation((req: any) => {
          if (req.method === "tools/list") return Promise.resolve({ tools: [{ name: "test_tool" }] });
          if (req.method === "resources/list") return Promise.resolve({ resources: [{ uri: "test://resource" }] });
          if (req.method === "tools/call") return Promise.resolve({ content: [{ text: "tool output" }] });
          if (req.method === "resources/read") return Promise.resolve({ contents: [{ text: "resource content" }] });
          return Promise.resolve({});
        })
      };
    })
  };
});

describe("ContinueMcpClient", () => {
  let client: ContinueMcpClient;

  beforeEach(() => {
    client = new ContinueMcpClient();
  });

  it("should initialize the client properly", () => {
    expect(client).toBeDefined();
    expect(client.client).toBeDefined();
  });

  it("should list tools", async () => {
    const result = await client.listTools();
    expect(result).toBeDefined();
    expect((result as any).tools[0].name).toBe("test_tool");
  });

  it("should call a tool", async () => {
    const result = await client.callTool("test_tool", {});
    expect(result).toBeDefined();
    expect((result as any).content[0].text).toBe("tool output");
  });
});
