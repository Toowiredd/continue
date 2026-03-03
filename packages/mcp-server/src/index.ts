import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { Core } from "core";
import { InProcessMessenger } from "core/protocol/messenger";
import { HeadlessIDE } from "./headlessIde";
import { registerTools } from "./tools";
import { registerResources } from "./resources";

export class ForgeMcpServer {
  public server: Server;
  private sseTransport: SSEServerTransport | null = null;
  public core: Core;

  constructor() {
    this.server = new Server(
      {
        name: "forge",
        version: "1.0.0",
        description:
          "Forge — AI-powered SWE dev solution as a standalone MCP server. Full toolkit: file I/O, bash, code search, git, AI chat, autocomplete, slash commands, session history, model management, codebase indexing, and more.",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    const ide = new HeadlessIDE();
    const messenger = new InProcessMessenger<any, any>();
    this.core = new Core(messenger, ide);

    registerTools(this.server, this.core);
    registerResources(this.server, this.core);
  }

  async start(transportType: "stdio" | "sse" = "stdio", port = 3100) {
    if (transportType === "stdio") {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      process.stderr.write("Forge MCP Server running on stdio\n");
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
        process.stderr.write(
          `Forge MCP Server running on SSE at http://localhost:${port}/mcp\n`,
        );
      });
    }
  }
}

/** Programmatic API — called by the VS Code extension */
export const start = (transport: "stdio" | "sse" = "stdio", port?: number) => {
  const server = new ForgeMcpServer();
  return server.start(transport, port);
};

// ---------------------------------------------------------------------------
// Direct CLI entry point:  node dist/index.js [--transport stdio|sse] [--port N]
// ---------------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  let transport: "stdio" | "sse" = "stdio";
  let port = 3100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transport" && args[i + 1]) {
      transport = args[++i] as "stdio" | "sse";
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    }
  }

  start(transport, port).catch((err) => {
    process.stderr.write(`Fatal: ${err}\n`);
    process.exit(1);
  });
}

