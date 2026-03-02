import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
} from "@modelcontextprotocol/sdk/types.js";

export class ContinueMcpClient {
  public client: Client;

  constructor() {
    this.client = new Client(
      {
        name: "continue-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
  }

  async connectStdio(command: string, args: string[], env?: Record<string, string>) {
    const transport = new StdioClientTransport({
      command,
      args,
      env,
    });
    await this.client.connect(transport);
  }

  async connectSSE(url: string) {
    const transport = new SSEClientTransport(new URL(url));
    await this.client.connect(transport);
  }

  async listTools() {
    return await this.client.request(
      { method: "tools/list" },
      ListToolsResultSchema
    );
  }

  async callTool(name: string, args: any) {
    return await this.client.request(
      {
        method: "tools/call",
        params: {
          name,
          arguments: args,
        },
      },
      CallToolResultSchema
    );
  }

  async listResources() {
    return await this.client.request(
      { method: "resources/list" },
      ListResourcesResultSchema
    );
  }

  async readResource(uri: string) {
    return await this.client.request(
      {
        method: "resources/read",
        params: {
          uri,
        },
      },
      ReadResourceResultSchema
    );
  }
}
