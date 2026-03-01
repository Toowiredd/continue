#!/usr/bin/env node

import { ContinueMcpClient } from "./index.js";

async function main() {
  const args = process.argv.slice(2);
  let transport: "stdio" | "sse" = "stdio";
  let url = "";
  let tool = "";
  let toolArgs = "{}";
  let resource = "";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--transport":
        transport = args[++i] as "stdio" | "sse";
        break;
      case "--url":
        url = args[++i];
        break;
      case "--tool":
        tool = args[++i];
        break;
      case "--args":
        toolArgs = args[++i];
        break;
      case "--resource":
        resource = args[++i];
        break;
    }
  }

  const client = new ContinueMcpClient();

  try {
    if (transport === "sse") {
      if (!url) throw new Error("--url is required for sse transport");
      await client.connectSSE(url);
    } else {
      // Connect to the local Continue MCP server for testing stdio
      const command = "node";
      const serverArgs = [
        "../mcp-server/dist/index.js",
      ];
      await client.connectStdio(command, serverArgs);
    }

    if (tool) {
      const parsedArgs = JSON.parse(toolArgs);
      const result = await client.callTool(tool, parsedArgs);
      console.log(JSON.stringify(result, null, 2));
    } else if (resource) {
      const result = await client.readResource(resource);
      console.log(JSON.stringify(result, null, 2));
    } else {
      const tools = await client.listTools();
      console.log("Available tools:", JSON.stringify(tools, null, 2));

      const resources = await client.listResources();
      console.log("Available resources:", JSON.stringify(resources, null, 2));
    }

  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
