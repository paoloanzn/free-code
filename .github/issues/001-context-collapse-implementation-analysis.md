# contextCollapse 服务实现详细分析

## 概述

contextCollapse 是一个**智能上下文压缩系统**，它通过以下方式管理长对话：
1. **分段压缩** - 将旧消息分组并生成摘要
2. **提交日志** - 持久化压缩记录（marble-origami-commit）
3. **快照管理** - 保存待处理和进行中的压缩状态
4. **溢出恢复** - 当达到 token 限制时自动恢复

## 核心概念

### 1. Commit（提交）
```typescript
ContextCollapseCommitEntry = {
  type: 'marble-origami-commit'
  sessionId: UUID
  collapseId: string        // 16位数字ID
  summaryUuid: string       // 摘要消息的UUID
  summaryContent: string    // <collapsed id="...">text</collapsed>
  summary: string           // 纯文本摘要
}
```

### 2. Snapshot（快照）
```typescript
ContextCollapseSnapshotEntry = {
  type: 'marble-origami-snapshot'
  sessionId: UUID
  staged: Array<{
    startUuid: string
    endUuid: string
    summary: string
    risk: number        // 风险评分
    stagedAt: number    // 时间戳
  }>
  // 触发器状态
}
```

### 3. 状态流转
```
消息列表 → 检测阈值 → 分段(stage) → 生成摘要 → 提交(commit) → 持久化
                ↑                                      ↓
                └────────── 溢出时恢复 ────────────────┘
```

## 需要实现的文件结构

```
src/services/contextCollapse/
├── index.ts          # 主模块，导出核心API
├── types.ts          # 类型定义（可合并到index.ts）
├── operations.ts     # projectView等操作
├── persist.ts        # 持久化/恢复
└── state.ts          # 状态管理（可选）
```

## 详细实现方案

### 1. index.ts - 主模块

```typescript
// 核心状态
interface CollapseState {
  enabled: boolean
  commits: ContextCollapseCommitEntry[]
  snapshot: ContextCollapseSnapshotEntry | null
  staged: StagedSpan[]
  nextCollapseId: number
}

const state: CollapseState = {
  enabled: true,
  commits: [],
  snapshot: null,
  staged: [],
  nextCollapseId: 1,
}

// 导出函数
export function isContextCollapseEnabled(): boolean
export async function applyCollapsesIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource: QuerySource
): Promise<{ messages: Message[] }>

export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLongMessage: (m: Message) => boolean,
  querySource: QuerySource
): boolean

export function recoverFromOverflow(
  messages: Message[],
  querySource: QuerySource
): { messages: Message[]; committed: number }

export function resetContextCollapse(): void

// TokenWarning 需要的统计
export function getStats(): CollapseStats
export function subscribe(callback: () => void): () => void
```

### 2. operations.ts - 视图操作

```typescript
/**
 * 将提交日志投影到消息列表
 * 用摘要替换已折叠的消息段
 */
export function projectView(messages: Message[]): Message[] {
  const commits = getCommits()
  // 对于每个 commit，找到对应的原始消息范围
  // 用 summaryContent 替换该范围内的消息
  // 返回新的消息列表
}

/**
 * 注册摘要到持久化存储
 */
export function registerSummary(
  summaryUuid: string,
  summary: string
): void

/**
 * 获取所有摘要
 */
export function getSummaries(): Map<string, string>
```

### 3. persist.ts - 持久化

```typescript
/**
 * 从日志条目恢复状态
 */
export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | null
): void {
  // 恢复 commits 到 state.commits
  // 恢复 snapshot 到 state.snapshot
  // 重新计算 nextCollapseId
}

/**
 * 保存当前状态到持久化存储
 */
export function persistState(): void
```

## 实现步骤

### 第一步：基础框架（可运行）

1. 创建 `index.ts` 框架，所有函数返回 safe defaults
2. 导出必要的类型
3. 确保构建通过

### 第二步：核心逻辑

1. 实现 `projectView` - 这是最核心的功能
2. 实现提交日志管理
3. 实现快照管理

### 第三步：高级功能

1. 实现 `applyCollapsesIfNeeded`
2. 实现溢出恢复
3. 实现统计和订阅

### 第四步：集成测试

1. 测试与 query.ts 的集成
2. 测试与 TokenWarning 的集成
3. 测试持久化/恢复

## 最小可行实现（MVP）

最简单的实现可以先让函数返回空值或原值，确保系统能运行：

```typescript
// index.ts MVP
export const isContextCollapseEnabled = () => false
export const applyCollapsesIfNeeded = async (messages) => ({ messages })
export const isWithheldPromptTooLong = () => false
export const recoverFromOverflow = (messages) => ({ messages, committed: 0 })
export const resetContextCollapse = () => {}
export const getStats = () => ({ collapsedSpans: 0, stagedSpans: 0, health: {} })
export const subscribe = () => () => {}

// operations.ts MVP
export const projectView = (messages) => messages
```

然后逐步添加真实逻辑。

## 依赖关系

```
query.ts
  ├── applyCollapsesIfNeeded
  ├── isContextCollapseEnabled
  ├── recoverFromOverflow
  └── isWithheldPromptTooLong

TokenWarning.tsx
  ├── isContextCollapseEnabled
  ├── getStats
  └── subscribe

REPL.tsx
  └── resetContextCollapse

commands/context/
  └── operations.projectView

ResumeConversation.tsx
  └── persist.restoreFromEntries
```

## 关键决策点

1. **何时触发折叠？** - 基于 token 阈值还是消息数量？
2. **如何生成摘要？** - 使用 LLM 还是简单截断？
3. **持久化策略？** - 文件存储还是内存存储？
4. **并发处理？** - 是否允许多个折叠同时进行？

## 建议的实现顺序

1. ✅ 基础 stub（已完成）
2. 🔄 projectView 最小实现
3. 🔄 提交日志管理
4. ⏳ 摘要生成逻辑
5. ⏳ 完整 applyCollapsesIfNeeded
6. ⏳ 溢出恢复
7. ⏳ 持久化/恢复

## 相关文件参考

- `src/services/compact/` - 类似的压缩逻辑可参考
- `src/services/compact/autoCompact.ts` - 自动压缩参考
- `src/services/compact/microCompact.ts` - 微压缩参考
