# Issue #7: Internal/Optional Features (Not Required for Public Build)

## Overview
These features are primarily for Anthropic internal use or advanced scenarios. They are **not required** for a functional public build.

## Features List

### AI Assistant Features
- [ ] `PROACTIVE` - Proactive AI suggestions
- [ ] `KAIROS` / `KAIROS_BRIEF` - Advanced AI assistant
- [ ] `KAIROS_PUSH_NOTIFICATION` - Push notifications
- [ ] `KAIROS_GITHUB_WEBHOOKS` - GitHub integration

### Infrastructure
- [ ] `BRIDGE_MODE` - IDE extension bridge (VS Code/JetBrains)
- [ ] `DAEMON` - Background daemon mode
- [ ] `COORDINATOR_MODE` - Multi-agent coordination
- [ ] `UDS_INBOX` - Unix domain socket inbox

### Experimental
- [ ] `VOICE_MODE` - Voice input/output
- [ ] `TERMINAL_PANEL` - Terminal panel capture
- [ ] `WEB_BROWSER_TOOL` - Web browser automation
- [ ] `BUDDY` - AI companion feature
- [ ] `TORCH` - PyTorch integration

### Testing/Development
- [ ] `OVERFLOW_TEST_TOOL` - Token overflow testing
- [ ] `MONITOR_TOOL` - System monitoring
- [ ] `AGENT_TRIGGERS` / `AGENT_TRIGGERS_REMOTE` - Agent automation

### Recommendation
**Do not implement** unless specifically needed. These are:
- Internal Anthropic features
- Experimental functionality
- Niche use cases
- Complex infrastructure requirements

## Notes
- These features may require additional infrastructure
- Some may have external dependencies (GitHub, external APIs)
- Most are gated by feature flags that default to false
- Focus effort on core functionality first
