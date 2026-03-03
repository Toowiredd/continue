import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Core } from "core";

export function registerResources(server: Server, core: Core) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "forge://config",
          name: "Forge Config",
          description: "Fully-resolved Forge configuration as JSON"
        },
        {
          uri: "forge://index/status",
          name: "Codebase Index Status",
          description: "Codebase indexing progress and stats"
        },
        {
          uri: "forge://stats",
          name: "Token Usage Stats",
          description: "AI token usage statistics (by day and by model)"
        }
      ]
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "forge://context/{type}",
          name: "Context provider output",
          description: "Output of a named Forge context provider (codebase, docs, diff, web, etc.)"
        },
        {
          uriTemplate: "forge://history/{session_id}",
          name: "Chat session",
          description: "A saved Forge chat session by ID"
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "forge://config") {
      const { config } = await core.configHandler.loadConfig();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(config, null, 2)
          }
        ]
      };
    } else if (uri === "forge://index/status") {
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ status: "running", progress: 100 }, null, 2)
          }
        ]
      };
    } else if (uri === "forge://stats") {
      let byDay: any[] = [];
      let byModel: any[] = [];
      try { byDay = await core.invoke("stats/getTokensPerDay", undefined); } catch { byDay = []; }
      try { byModel = await core.invoke("stats/getTokensPerModel", undefined); } catch { byModel = []; }
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ byDay, byModel }, null, 2)
          }
        ]
      };
    } else if (uri.startsWith("forge://context/")) {
      const type = uri.split("/").pop();
      const result = await core.invoke("context/getContextItems", {
        name: type as string,
        query: "",
        fullInput: "",
        selectedCode: [],
        isInAgentMode: false
      });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } else if (uri.startsWith("forge://history/")) {
      const sessionId = uri.replace("forge://history/", "");
      const result = await core.invoke("history/load", { id: sessionId });
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    throw new Error(`Resource not found: ${uri}`);
  });
}
