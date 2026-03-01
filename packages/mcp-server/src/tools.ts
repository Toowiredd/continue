import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { Core } from "core";

export function registerTools(server: Server, core: Core) {
  const tools: Tool[] = [
    {
      name: "continue_autocomplete",
      description: "Get inline code completion at a given file path and cursor position",
      inputSchema: {
        type: "object",
        properties: {
          filepath: { type: "string", description: "Path to the file" },
          pos: {
            type: "object",
            properties: {
              line: { type: "number" },
              character: { type: "number" }
            },
            required: ["line", "character"]
          },
          recentlyVisitedRanges: {
            type: "array",
            items: {
              type: "object"
            }
          },
          recentlyEditedRanges: {
            type: "array",
            items: {
              type: "object"
            }
          },
          gitOperations: { type: "string" }
        },
        required: ["filepath", "pos", "recentlyVisitedRanges", "recentlyEditedRanges"]
      }
    },
    {
      name: "continue_chat",
      description: "Multi-turn chat with the configured LLM, accepts messages array and returns assistant reply",
      inputSchema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant", "system"] },
                content: { type: "string" }
              },
              required: ["role", "content"]
            }
          },
          modelTitle: { type: "string", description: "Optional model title to use" }
        },
        required: ["messages"]
      }
    },
    {
      name: "continue_edit",
      description: "Apply a natural-language edit instruction to a specified code range",
      inputSchema: {
        type: "object",
        properties: {
          filepath: { type: "string" },
          instruction: { type: "string" },
          range: {
            type: "object",
            properties: {
              start: {
                type: "object",
                properties: { line: { type: "number" }, character: { type: "number" } },
                required: ["line", "character"]
              },
              end: {
                type: "object",
                properties: { line: { type: "number" }, character: { type: "number" } },
                required: ["line", "character"]
              }
            },
            required: ["start", "end"]
          }
        },
        required: ["filepath", "instruction", "range"]
      }
    },
    {
      name: "continue_context_retrieval",
      description: "Run the full context provider pipeline (codebase, docs, web, terminal, etc.) and return ranked context items",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the context provider" },
          query: { type: "string", description: "Query to retrieve context for" },
          fullInput: { type: "string" }
        },
        required: ["name", "query", "fullInput"]
      }
    },
    {
      name: "continue_index_codebase",
      description: "Trigger or query status of the codebase indexing pipeline",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["trigger", "status"] }
        },
        required: ["action"]
      }
    },
    {
      name: "continue_run_slash_command",
      description: "Execute any registered slash command by name with optional arguments",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the slash command (e.g. 'commit', 'edit')" },
          input: { type: "string", description: "Input to pass to the slash command" }
        },
        required: ["name", "input"]
      }
    },
    {
      name: "continue_get_config",
      description: "Return the current fully-resolved config (models, providers, context providers, slash commands)",
      inputSchema: {
        type: "object",
        properties: {}
      }
    }
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "continue_autocomplete") {
        const result = await core.invoke("autocomplete/complete", {
          filepath: args?.filepath as string,
          pos: args?.pos as any,
          recentlyVisitedRanges: args?.recentlyVisitedRanges as any,
          recentlyEditedRanges: args?.recentlyEditedRanges as any,
          isUntitledFile: false,
          completionId: "mcp-completion"
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } else if (name === "continue_chat") {
        let resultStr = "";
        for await (const chunk of core.invoke("llm/streamChat", {
          messages: args?.messages as any,
          title: args?.modelTitle as string || "",
          completionOptions: {}
        })) {
          resultStr += chunk.content;
        }
        return {
          content: [{ type: "text", text: resultStr }]
        };
      } else if (name === "continue_edit") {
        let resultStr = "";
        for await (const diffLine of core.invoke("streamDiffLines", {
          prefix: "",
          highlighted: "",
          suffix: "",
          input: args?.instruction as string,
          language: "typescript",
          modelTitle: "",
          completionOptions: {}
        })) {
          resultStr += JSON.stringify(diffLine) + "\n";
        }
        return {
          content: [{ type: "text", text: resultStr }]
        };
      } else if (name === "continue_context_retrieval") {
        const result = await core.invoke("context/getContextItems", {
          name: args?.name as string,
          query: args?.query as string,
          fullInput: args?.fullInput as string,
          selectedCode: [],
          isInAgentMode: false
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }]
        };
      } else if (name === "continue_index_codebase") {
        if (args?.action === "trigger") {
          await core.invoke("index/forceReIndex", { shouldClearIndexes: false });
          return {
            content: [{ type: "text", text: "Indexing triggered." }]
          };
        } else {
          return {
            content: [{ type: "text", text: "Use continue://index/status resource instead." }]
          };
        }
      } else if (name === "continue_run_slash_command") {
        const result = await core.invoke("llm/streamChat", {
          messages: [],
          title: "",
          completionOptions: {},
          legacySlashCommandData: {
            command: { name: args?.name as string, description: "" } as any,
            input: args?.input as string,
            contextItems: [],
            historyIndex: 0,
            selectedCode: []
          }
        });
        let resultStr = "";
        for await (const chunk of result as any) {
          resultStr += chunk.content;
        }
        return {
          content: [{ type: "text", text: resultStr }]
        };
      } else if (name === "continue_get_config") {
        const config = await core.configHandler.loadConfig();
        return {
          content: [{ type: "text", text: JSON.stringify(config.config) }]
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error}` }],
        isError: true
      };
    }
  });
}
