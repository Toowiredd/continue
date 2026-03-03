# Fork Investigation Report

## 1  Open PR Analysis — PR #1

**Title:** feat: Fully Convert Continue IDE Extension into Production MCP Server  
**Branch:** `feat/mcp-server-client-14774617016358226076` → `main`  
**Author:** @Toowiredd (via Google Jules AI task 14774617016358226076)  
**State:** open, not merged  
**Size:** +63 098 / −3 182 lines across 24 files

### What the PR adds

| Area | Change |
|---|---|
| `packages/mcp-server/` | New package: headless Continue `Core` exposed as an MCP server (STDIO + SSE transports) |
| `packages/mcp-client/` | New package: CLI + programmatic client for the MCP server |
| `extensions/vscode/package.json` | Two new settings (`continue.mcpServer.enabled`, `continue.mcpServer.port`) and a dev-dependency on `@continue/mcp-server` |
| `extensions/vscode/src/extension.ts` | Optionally starts the MCP server on extension activation |

### Artifacts that should be cleaned up before merging

The PR also introduces several files that are development artifacts and should **not** be committed:

| File | Issue |
|---|---|
| `extensions/vscode/src/extension.ts.orig` | Patch backup — not source code |
| `extensions/vscode/src/extension.ts.patch` | Diff patch file — not source code |
| `fix_tools.js` | One-off fix script at repo root — not source code |
| `packages/mcp-server/src/tools.ts.patch` | Patch artifact — not source code |

### Automated review findings (Gemini Code Assist)

Gemini Code Assist posted a review noting the PR is architecturally sound and does not affect existing VS Code / JetBrains extension behaviour because the MCP server only starts when `continue.mcpServer.enabled` is `true` (default: `false`).

### Recommendation

1. Remove the four artifact files listed above.
2. Add the new `packages/mcp-server` and `packages/mcp-client` directories to the root `package.json` workspaces array if not already present (the PR's description says it adds them, but the diff only shows `tsconfig.json` for `mcp-server` — double-check `package.json`).
3. Merge after the fork has been synced with upstream to avoid conflict-heavy merge.

---

## 2  Upstream Sync Status

| Metric | Value |
|---|---|
| Fork | `Toowiredd/continue` |
| Upstream | `continuedev/continue` |
| Fork `main` HEAD | `b2aba742` (2025-10-15) |
| Commits behind upstream | **≈ 1 693** |
| Fork-only commits on `main` | **0** (all custom work lives in PR branch) |

Because the fork's `main` has no diverging commits of its own, the sync is a **clean fast-forward** — no conflicts are expected when merging upstream commits.

---

## 3  Sync Workflow

A GitHub Actions workflow has been added at `.github/workflows/sync-upstream.yml`.

### What it does
- Runs **daily at 06:00 UTC** (or on-demand via `workflow_dispatch`).
- Fetches `continuedev/continue:main` and reports how many commits the fork is behind.
- Merges upstream into the fork's `main` and pushes (using `GITHUB_TOKEN` — **no push to upstream**).
- Supports a `dry_run` option that only prints the divergence without making changes.

### How to trigger manually
1. Go to **Actions → Sync Fork with Upstream**.
2. Click **Run workflow**.
3. Optionally set `dry_run = true` to preview without pushing.

---

## 4  Ensuring No Changes Reach the Upstream Repo

- The workflow uses `git push origin main` (the fork), never `git push upstream`.
- `GITHUB_TOKEN` is scoped to `Toowiredd/continue` only; it has no write access to `continuedev/continue`.
- PR #1 targets `Toowiredd/continue:main`, not `continuedev/continue:main`.
