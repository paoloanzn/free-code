# Claude Code Public Build - Implementation Issues

This directory tracks missing implementations for the public build of Claude Code CLI.

## Priority Summary

| Priority | Issue | Impact | Status |
|----------|-------|--------|--------|
| 🔴 High | [#1](./001-context-collapse-high.md) | Context Collapse Service | **✅ Completed** |
| 🟡 Medium | [#2](./002-cached-microcompact-medium.md) | Cached Microcompact | Not Started |
| 🟡 Medium | [#3](./003-task-summary-bg-sessions-medium.md) | Task Summary (BG_SESSIONS) | Not Started |
| 🟡 Medium | [#4](./004-token-budget-medium.md) | Token Budget | Not Started |
| 🟢 Low | [#5](./005-workflow-scripts-low.md) | Workflow Scripts | Not Started |
| 🟢 Low | [#6](./006-ctx-inspect-tool-low.md) | CtxInspect Tool | Not Started |
| ⚪ Optional | [#7](./007-internal-features-optional.md) | Internal Features | N/A |

## Completed

- ✅ **contextCollapse** - Full smart context compression service
- ✅ snipCompact - Context compression
- ✅ snipProjection - Snip boundary detection
- ✅ SnipTool - Manual snip command
- ✅ protectedNamespace - Security check
- ✅ TungstenTool - Search tool stub
- ✅ claude-for-chrome-mcp - Chrome integration types
- ✅ color-diff-napi - Color diffing stub
- ✅ modifiers-napi - Modifier check stub

## How to Use These Issues

1. Pick an issue by priority
2. Read the requirements and acceptance criteria
3. Check related files and integration points
4. Implement and test
5. Update this README to mark as completed

## Notes

- Issues are organized by impact on user experience
- High priority issues affect core functionality
- Medium priority issues improve performance/features
- Low priority issues are nice-to-have enhancements
- Optional features are primarily for internal Anthropic use
