# Issue #6: Implement CtxInspectTool (Low Priority)

## Overview
Context inspection tool for debugging and analyzing conversation context.

## Current State
**Usage in tools.ts**:
```typescript
const CtxInspectTool = feature('CONTEXT_COLLAPSE')
  ? require('./tools/CtxInspectTool/CtxInspectTool.js').CtxInspectTool
  : null
```

## Required Implementations

### Core Tool
- [ ] `src/tools/CtxInspectTool/CtxInspectTool.ts`
  - Context inspection functionality
  - Token usage analysis
  - Message structure inspection
  - Export capabilities

### Features
- [ ] Display current context statistics
- [ ] Show token breakdown by message
- [ ] Export context to file
- [ ] Analyze context efficiency

## Dependencies
- Depends on Issue #1 (contextCollapse) being implemented
- Uses context collapse data for analysis

## Impact
- **Low**: Debugging/development tool
- Useful for troubleshooting context issues
- Not required for normal operation

## Acceptance Criteria
- [ ] Tool implementation complete
- [ ] Context statistics display
- [ ] Token breakdown analysis
- [ ] Export functionality
- [ ] Integration with tools.ts
