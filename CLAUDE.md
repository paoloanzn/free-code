# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a fork of Anthropic's Claude Code CLI. The fork removes telemetry, strips security-prompt guardrails, and enables 45+ experimental feature flags (see `FEATURES.md` for full audit).

## Build Commands

```bash
bun run build        # Production build
bun run build:dev    # Dev build
bun run dev          # Run CLI directly (src/entrypoints/cli.tsx)
```

Uses Bun (v1.3.11) with TypeScript (strict: false, skipLibCheck: true). No test runner, linter, or formatter configured.

## Architecture Overview

### Entry Points

- **CLI** (`src/entrypoints/cli.tsx`): Bootstrap with fast-path flags (--version, --dump-system-prompt, --daemon-worker, remote modes). Falls through to main.tsx.
- **Desktop** (`src/main.tsx`): Loads analytics, auth, API, MCP, tools; launches REPL or CLI handler.

### Initialization Flow

1. `cli.tsx` handles fast-path flags with zero/dynamic imports
2. `main.tsx` runs parallel prefetch (MDM settings, keychain reads)
3. `init()` from `entrypoints/init.ts` - telemetry/trust
4. `setup()` from `setup.ts` - session init (cwd, git root, hooks, memory)
5. `context.ts` - system/user prompt context
6. `launchRepl()` or commander-based CLI

### Layers

```
CLI entrypoint → main.tsx → bootstrap/state, setup, context, services
  → bridge (desktop/REPL comms) → commands, tools, coordinator → QueryEngine
```

### Coordinator

Multi-agent orchestration via `COORDINATOR_MODE` feature flag + `CLAUDE_CODE_COORDINATOR_MODE` env var. Provides internal worker tools (TEAM_CREATE, TEAM_DELETE, SEND_MESSAGE, etc.).

### Feature Flags

All feature flags use `feature('FLAG_NAME')` from `bun:bundle`. Key flags:
- `ULTRAPLAN` - Remote multi-agent planning
- `ULTRATHINK` - Deep thinking mode ("ultrathink" command)
- `VOICE_MODE` - Push-to-talk voice input
- `AGENT_TRIGGERS` - Local cron/trigger tools
- `BRIDGE_MODE` - IDE remote-control bridge (VS Code, JetBrains)
- `TOKEN_BUDGET` - Token budget tracking
- `BUILTIN_EXPLORE_PLAN_AGENTS` - Built-in explore/plan agent presets
- `VERIFICATION_AGENT` - Task validation agent
- `BASH_CLASSIFIER` - Classifier-assisted bash permissions
- `EXTRACT_MEMORIES` - Post-query memory extraction
- `HISTORY_PICKER` - Interactive prompt history

## Core Domains

### QueryEngine (`src/query.ts`, `src/QueryEngine.ts`)

Async generator orchestrating the main query loop. Each `submitMessage()` starts a new turn with:
1. Process user input (slash commands, permissions)
2. Build system prompt from `fetchSystemPromptParts`
3. Call AI model API
4. Handle tool calls via `runTools`/`StreamingToolExecutor`
5. Compact context when needed

State: `mutableMessages` (conversation history), `readFileState` (LRU file cache), `permissionDenials`, `totalUsage` (cost tracking).

### Tool System

- Every tool implements `Tool` type (~30 methods) from `src/Tool.ts`
- Built via `buildTool()` helper with Zod schema validation
- `getAllBaseTools()` returns ~40 built-in tools, conditionally loaded via `feature()` flags
- `assembleToolPool()` merges built-in + MCP tools
- Tool structure: `src/tools/<ToolName>/Tool.ts`, `UI.tsx`, `prompt.ts`

### Command System

- `src/commands.ts`: `COMMANDS()` returns ~80 built-in commands
- Command types: `prompt` (model-invocable), `local` (local exec), `local-jsx` (Ink UI)
- Sources: built-in, skill dir, plugins, bundled skills, workflow commands, MCP skills
- `getSlashCommandToolSkills()` returns prompt-type commands for model invocation

### Task System (`src/Task.ts`)

Task types: `local_bash`, `local_agent`, `remote_agent`, `in_process_teammate`, `local_workflow`, `monitor_mcp`, `dream`

- `QueryEngine` handles main conversation loop
- Tasks manage background work spawned during tool execution (via `AgentTool`, `TaskStopTool`)
- Tasks registered in `AppState.tasks` map, run orthogonal to query loop

## State Management

Custom store (similar to Zustand) in `src/state/store.ts`: `createStore<T>` with `getState`, `setState`, `subscribe` interface.

`AppStateProvider` wraps React Context + `useSyncExternalStore`. Single `AppState` object accessed via `useAppState(selector)` hook.

## Key Services (`src/services/`)

- **analytics/** - Datadog, GrowthBook, event logging
- **api/** - API clients: bootstrap, claude, files, grove, logging, usage, metrics
- **compact/** - Session compaction (autoCompact, microCompact, snipCompact)
- **lsp/** - Language Server Protocol client/manager
- **mcp/** - Model Context Protocol connections, OAuth, channel permissions
- **oauth/** - Auth code listeners, portable auth
- **AgentSummary, MagicDocs, PromptSuggestion, SessionMemory** - Feature services

## Utilities (`src/utils/`)

Notable subdirectories:
- **bash/** - Parser, shell commands, treeSitter analysis
- **computer_use/** - App names, executor, locks, drainRunLoop
- **background/remote/** - Remote session utilities

## Components (`src/components/`)

~100+ small, focused components in flat structure. Notable: `CustomSelect/`, `FeedbackSurvey/`, `HelpV2/`, `MCPServerDialog/`, `ManagedSettingsSecurityDialog/`.

## Hooks (`src/hooks/`)

Key patterns: `useSettings`, `useIdeConnectionStatus`, `useMCPConnections`, `useMergedClients`, `useCommandQueue`. Permission handlers in `toolPermission/` with coordinator/interactive/swarm handlers.
