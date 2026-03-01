const fs = require('fs');
let content = fs.readFileSync('packages/mcp-server/src/tools.ts', 'utf8');

content = content.replace(
  /const result = await core\.invoke\("mcp\/getPrompt", \{[\s\S]*?return \{\n\s*content: \[\{ type: "text", text: JSON\.stringify\(result\) \}\]\n\s*\};\n/,
  `let resultStr = "";
        for await (const diffLine of core.invoke("streamDiffLines", {
          prefix: "",
          highlighted: "",
          suffix: "",
          input: args?.instruction as string,
          language: "typescript",
          modelTitle: "",
          completionOptions: {}
        })) {
          resultStr += JSON.stringify(diffLine) + "\\n";
        }
        return {
          content: [{ type: "text", text: resultStr }]
        };\n`
);

fs.writeFileSync('packages/mcp-server/src/tools.ts', content);
