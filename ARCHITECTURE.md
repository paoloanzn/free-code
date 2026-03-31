# Architecture

Deep dive into how free-code (Claude Code) works internally.

## Overview

```
User Input → QueryEngine → AI Model API → Tool Execution → Response
                ↑__________________________________|
                      (loop until task complete)
```

The app runs a conversation loop with an AI model, which can call tools (Bash, Read, Edit, etc.) to interact with the filesystem and system. Context is compacted when it grows too large.

---

## Entry Points

### cli.tsx - Bootstrap
- Handles fast-path flags with zero/dynamic imports for speed:
  - `--version` / `-v` - print version, exit
  - `--dump-system-prompt` - output rendered system prompt, exit
  - `--claude-in-chrome-mcp` / `--chrome-native-host` - Chrome integration
  - `--computer-use-mcp` - computer use mode
  - `--daemon-worker` - internal supervisor spawning
  - `remote`, `bridge`, `daemon`, `ps`, `logs`, `attach`, `kill` - daemon modes
  - `templates`, `environment-runner`, `self-hosted-runner` - template modes
  - `--tmux` - tmux integration
- All other paths fall through to main.tsx

### main.tsx - Full Init
1. Parallel prefetch: MDM settings, keychain reads
2. Feature flags gate COORDINATOR_MODE and KAIROS imports
3. Load all major systems: analytics, auth, API, MCP, tools
4. Call init() then setup() then context.ts
5. Launch REPL or commander-based CLI

---

## Core Loop - QueryEngine

Located in `src/query.ts` and `src/QueryEngine.ts`.

**QueryEngine** is an async generator that owns the query lifecycle per conversation.

### Query Flow Per Turn

```
submitMessage(userInput)
  1. processUserInput()      → slash commands, permissions
  2. fetchSystemPromptParts() → build system prompt
  3. callModel()             → call AI model API
  4. runTools()              → StreamingToolExecutor handles tool calls
  5. handleResponse()        → process model response
  6. compactContext()        → if needed, reduce context size
  7. yield stream events, messages, tool summaries
```

### State Maintained

- `mutableMessages[]` - conversation history
- `readFileState` - LRU cache of file contents
- `permissionDenials[]` - track denied permissions
- `totalUsage` - cost tracking

---

## Tool System

### Tool Interface (src/Tool.ts)

Every tool implements the `Tool` type with ~30 methods:
- `call()` - actual execution
- `description()` - human-readable description
- `prompt()` - how the model sees this tool
- `renderToolUseMessage()` / `renderToolResultMessage()` - UI rendering
- Input/output validated via Zod schemas

### Tool Builder (src/tools.ts)

```typescript
getAllBaseTools()      // ~40 built-in tools
getTools()             // + permission filtering, mode filtering
assembleToolPool()      // + MCP tools
```

Tools are conditionally loaded via `feature('FLAG_NAME')` from `bun:bundle`.

### Tool Structure

Each tool lives in `src/tools/<ToolName>/`:
- `Tool.ts` - main implementation
- `UI.tsx` - React component for rendering
- `prompt.ts` - prompt instructions for the model

### Tool Execution (services/tools/toolOrchestration.js)

`runTools()` handles execution. `StreamingToolExecutor` streams results back to the model.

### Built-in Tools

Key tools include: Bash, Read, Edit, Write, Grep, Glob, NotebookRead, NotebookEdit, TaskCreate, TaskComplete, WebSearch, WebFetch, etc.

---

## Command System

Commands are prefixed with `/` and executed locally (not by the model).

### Command Types

- **prompt** - model can invoke them (`/plan`, `/review`, `/commit`)
- **local** - local execution only (`/help`, `/clear`, `/exit`)
- **local-jsx** - render Ink UI (`/connect`, `/mcp`)

### Registration (src/commands.ts)

```typescript
COMMANDS()              // ~80 built-in commands
loadAllCommands()       // memoized loading
getCommands()           // filter by availability + isCommandEnabled()
getSlashCommandToolSkills()  // prompt-type for model invocation
```

### Sources

1. Built-in commands (src/commands/)
2. Skill dir commands
3. Plugin skills
4. Bundled skills
5. Workflow commands
6. MCP skills

---

## Task System

Background work that runs orthogonal to the query loop.

### Task Types (src/Task.ts)

- `local_bash` - spawned bash process
- `local_agent` - local sub-agent
- `remote_agent` - remote sub-agent
- `in_process_teammate` - in-process teammate
- `local_workflow` - workflow runner
- `monitor_mcp` - MCP connection monitor
- `dream` - dream mode

### Task Lifecycle

1. Created via `AgentTool` during query execution
2. Registered in `AppState.tasks` map
3. Runs independently of query loop
4. Can communicate results back to parent agent

---

## State Management

### Store (src/state/store.ts)

Custom Zustand-like store:
```typescript
createStore<T>({
  getState(),
  setState(),
  subscribe()
})
```

### React Integration

`AppStateProvider` wraps React Context + `useSyncExternalStore`.

Access via `useAppState(selector)` - selectors return stable references to avoid re-renders.

---

## Coordinator Mode

Multi-agent orchestration via `COORDINATOR_MODE` feature flag.

When enabled, provides internal worker tools:
- `TEAM_CREATE` - create a team
- `TEAM_DELETE` - delete a team
- `SEND_MESSAGE` - message a teammate
- `SEND_MESSAGE_TO_WORKTEAM` - message a work team
- `GET_TEAM_MEMBERS` - list team members

Environment variable: `CLAUDE_CODE_COORDINATOR_MODE`

---

## Services

### analytics/
- Datadog integration
- GrowthBook feature flags (local eval only, no reporting)
- First-party event logging

### api/
- bootstrap - bootstrap API
- claude - main Claude API client
- files - file operations
- grove - internal service
- logging - event logging
- usage - usage tracking
- metrics - metrics collection

### compact/
Session context compaction:
- autoCompact - automatic compaction
- microCompact - lightweight compaction
- snipCompact - snippet-based compaction

### lsp/
Language Server Protocol client/manager for code intelligence.

### mcp/
Model Context Protocol:
- MCP connections management
- OAuth handling
- Channel permissions

### oauth/
- Auth code listeners
- Portable auth flows

---

## Initialization Sequence

```
cli.tsx (fast-path flags)
    ↓
main.tsx
    ├── Parallel prefetch (MDM, keychain)
    ├── Feature flag gates
    └── init() [entrypoints/init.ts]
            └── setup() [setup.ts]
                    ├── Session init (cwd, git root)
                    ├── Hooks setup
                    ├── Memory init
                    └── context() [context.ts]
                            ├── System context
                            └── User context
                                    ↓
                            launchRepl() or CLI handler
```

---

## Feature Flags

All flags use `feature('FLAG_NAME')` from `bun:bundle` - compile-time dead code elimination.

Key flags:
- `ULTRAPLAN` - Remote multi-agent planning
- `ULTRATHINK` - Deep thinking mode
- `VOICE_MODE` - Voice input
- `AGENT_TRIGGERS` - Cron/trigger tools
- `BRIDGE_MODE` - IDE bridge
- `COORDINATOR_MODE` - Multi-agent teams
- `TOKEN_BUDGET` - Usage tracking
- `VERIFICATION_AGENT` - Task validation

See `FEATURES.md` for full audit of all 88 flags.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/query.ts` | Query generator (async) |
| `src/QueryEngine.ts` | Query lifecycle class |
| `src/Tool.ts` | Tool interface definition |
| `src/tools.ts` | Tool registration |
| `src/commands.ts` | Command registration |
| `src/Task.ts` | Task types and creation |
| `src/state/store.ts` | State management |
| `src/context.ts` | System/user context |
| `src/setup.ts` | Session setup |
| `src/main.tsx` | Main entrypoint |
| `src/entrypoints/cli.tsx` | CLI bootstrap |
| `src/services/tools/toolOrchestration.js` | Tool execution |
