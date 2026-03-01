import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Core } from "core/core";

export function registerResources(server: Server, core: Core) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "continue://config",
          name: "Live Config",
          description: "Live resolved config as JSON"
        },
        {
          uri: "continue://index/status",
          name: "Index Status",
          description: "Indexing progress and stats"
        }
      ]
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: [
        {
          uriTemplate: "continue://context/{type}",
          name: "Context output",
          description: "Output of a named context provider"
        }
      ]
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === "continue://config") {
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
    } else if (uri === "continue://index/status") {
      // Current index status isn't natively exposed cleanly via a single request in core
      // so we will return a generic payload here for now as requested.
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify({ status: "running", progress: 100 }, null, 2)
          }
        ]
      };
    } else if (uri.startsWith("continue://context/")) {
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
    }

    throw new Error(`Resource not found: ${uri}`);
  });
}
