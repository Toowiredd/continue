import { IDE } from "core";
import { IdeInfo, IdeSettings, FileType, Thread, TerminalOptions, Range, RangeInFile } from "core";
import { ContinueRcJson, Problem, Location, IndexTag, FileStatsMap, SignatureHelp, DocumentSymbol } from "core";
import * as fs from "fs";
import * as path from "path";

export class HeadlessIDE implements IDE {
  constructor(private workspaceDir?: string) {}

  async getIdeInfo(): Promise<IdeInfo> {
    return {
      ideType: "vscode",
      name: "Headless MCP",
      version: "1.0.0",
      remoteName: "local",
      extensionVersion: "1.0.0",
      isPrerelease: false
    };
  }

  async getIdeSettings(): Promise<IdeSettings> {
    return {
      remoteConfigServerUrl: undefined,
      remoteConfigSyncPeriod: 60,
      userToken: "",
      pauseCodebaseIndexOnStart: false,
      continueTestEnvironment: "production"
    };
  }

  async getDiff(includeUnstaged: boolean): Promise<string[]> {
    return [];
  }

  async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    return { text: "", copiedAt: new Date().toISOString() };
  }

  async isTelemetryEnabled(): Promise<boolean> {
    return false;
  }

  async isWorkspaceRemote(): Promise<boolean> {
    return false;
  }

  async getUniqueId(): Promise<string> {
    return "headless-mcp-id";
  }

  async getTerminalContents(): Promise<string> {
    return "";
  }

  async getDebugLocals(threadIndex: number): Promise<string> {
    return "";
  }

  async getTopLevelCallStackSources(threadIndex: number, stepBack: number): Promise<string[]> {
    return [];
  }

  async getAvailableThreads(): Promise<Thread[]> {
    return [];
  }

  async getWorkspaceDirs(): Promise<string[]> {
    return this.workspaceDir ? [this.workspaceDir] : [];
  }

  async getWorkspaceConfigs(): Promise<ContinueRcJson[]> {
    return [];
  }

  async fileExists(filepath: string): Promise<boolean> {
    return fs.existsSync(filepath);
  }

  async writeFile(filepath: string, contents: string): Promise<void> {
    await fs.promises.writeFile(filepath, contents, "utf8");
  }

  async readFile(filepath: string): Promise<string> {
    if (!fs.existsSync(filepath)) {
      return "";
    }
    return fs.promises.readFile(filepath, "utf8");
  }

  async readRangeInFile(fileUri: string, range: Range): Promise<string> {
    const contents = await this.readFile(fileUri);
    const lines = contents.split("\n");
    return lines.slice(range.start.line, range.end.line + 1).join("\n");
  }

  async showLines(filepath: string, startLine: number, endLine: number): Promise<void> {}

  async showVirtualFile(title: string, content: string): Promise<void> {}

  async openFile(path: string): Promise<void> {}

  async openUrl(url: string): Promise<void> {}

  async runCommand(command: string, options?: TerminalOptions): Promise<void> {}

  async saveFile(fileUri: string): Promise<void> {}

  async getOpenFiles(): Promise<string[]> {
    return [];
  }

  async getCurrentFile(): Promise<{ isUntitled: boolean; path: string; contents: string } | undefined> {
    return undefined;
  }

  async getPinnedFiles(): Promise<string[]> {
    return [];
  }

  async getSearchResults(query: string): Promise<string> {
    return "";
  }

  async getProblems(filepath?: string): Promise<Problem[]> {
    return [];
  }

  async subprocess(command: string, cwd?: string): Promise<[string, string]> {
    return ["", ""];
  }

  async getBranch(dir: string): Promise<string> {
    return "main";
  }

  async getTags(artifactId: string): Promise<IndexTag[]> {
    return [];
  }

  async gotoDefinition(location: Location): Promise<RangeInFile[]> {
    return [];
  }

  async gotoTypeDefinition(location: Location): Promise<RangeInFile[]> {
    return [];
  }

  async getSignatureHelp(location: Location): Promise<SignatureHelp | null> {
    return null;
  }

  async getReferences(location: Location): Promise<RangeInFile[]> {
    return [];
  }

  async getDocumentSymbols(textDocumentIdentifier: string): Promise<DocumentSymbol[]> {
    return [];
  }

  onDidChangeActiveTextEditor(callback: (fileUri: string) => void): void {}

  async applyFileSystemEdit(edit: any): Promise<void> {}

  async getFileContextItems(filepaths: string[]): Promise<any[]> {
    return [];
  }

  async showToast(...args: any[]): Promise<any> {}

  pathSep(): string {
    return path.sep;
  }

  async readEnvVar(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async getRepoName(dir: string): Promise<string | undefined> {
    return path.basename(dir);
  }

  async getFileResults(pattern: string, maxResults?: number): Promise<string[]> {
    return [];
  }

  async getGitRootPath(dir: string): Promise<string | undefined> {
    return undefined;
  }

  async listDir(dir: string): Promise<[string, FileType][]> {
    if (!fs.existsSync(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.map(entry => [
      entry.name,
      entry.isDirectory() ? 2 : entry.isFile() ? 1 : 0 as any
    ]);
  }

  async getFileStats(files: string[]): Promise<FileStatsMap> {
    const result: FileStatsMap = {};
    for (const file of files) {
      if (fs.existsSync(file)) {
        const stats = await fs.promises.stat(file);
        result[file] = {
            lastModified: stats.mtimeMs,
            size: stats.size
        } as any;
      }
    }
    return result;
  }

  async readSecrets(keys: string[]): Promise<Record<string, string>> {
    return {};
  }

  async writeSecrets(secrets: { [key: string]: string }): Promise<void> {}
}
