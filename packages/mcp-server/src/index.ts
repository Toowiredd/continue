import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { Core } from "core";
import { InProcessMessenger } from "core/protocol/messenger";
import { HeadlessIDE } from "./headlessIde";
import { registerTools } from "./tools";
import { registerResources } from "./resources";

export class ContinueMcpServer {
  public server: Server;
  private sseTransport: SSEServerTransport | null = null;
  public core: Core;

  constructor() {
    this.server = new Server(
      {
        name: "continue",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    const ide = new HeadlessIDE();
    const messenger = new InProcessMessenger<any, any>();
    this.core = new Core(messenger, ide);

    registerTools(this.server, this.core);
    registerResources(this.server, this.core);
  }

  async start(transportType: "stdio" | "sse" = "stdio", port: number = 3100) {
    if (transportType === "stdio") {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.log("Continue MCP Server running on stdio");
    } else {
      const app = express();

      app.get("/mcp", async (req: any, res: any) => {
        this.sseTransport = new SSEServerTransport("/message", res);
        await this.server.connect(this.sseTransport);
      });

      app.post("/message", async (req: any, res: any) => {
        if (this.sseTransport) {
          await this.sseTransport.handlePostMessage(req, res);
        } else {
          res.status(503).send("Server not connected");
        }
      });

      app.listen(port, () => {
        console.log(`Continue MCP Server running on SSE at http://localhost:${port}/mcp`);
      });
    }
  }
}

export const start = (transport: "stdio" | "sse" = "stdio", port?: number) => {
  const server = new ContinueMcpServer();
  return server.start(transport, port);
};
