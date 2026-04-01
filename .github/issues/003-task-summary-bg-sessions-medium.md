# Issue #3: Implement taskSummary Module for BG_SESSIONS (Medium Priority)

## Overview
The `BG_SESSIONS` feature requires a `taskSummary` module that is currently missing.

## Current State
**File**: Not created - `src/utils/taskSummary.js`

**Usage in query.ts**:
```typescript
const taskSummaryModule = feature('BG_SESSIONS')
  ? (require('./utils/taskSummary.js') as typeof import('./utils/taskSummary.js'))
  : null
```

## Required Implementations

### Core Functions
- [ ] Task summary generation from conversation
- [ ] Background session management
- [ ] Session state persistence
- [ ] Task progress tracking

### Types Needed
```typescript
interface TaskSummary {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  progress?: number
  lastUpdated: string
}

interface BackgroundSession {
  taskId: string
  messages: Message[]
  context: Record<string, unknown>
}
```

## Impact
- **Medium**: Enables background/parallel task execution
- Allows long-running tasks to continue in background
- Related to agent workflows

## Related Features
- `BG_SESSIONS` feature flag
- Agent tool functionality
- Workflow scripts

## Acceptance Criteria
- [ ] Module created with all required exports
- [ ] Task summary generation working
- [ ] Background session state management
- [ ] Integration with query.ts
- [ ] Persistence across sessions
