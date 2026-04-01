import memoize from 'lodash-es/memoize.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

/**
 * Discover skills exposed by an MCP server via `skill://` resource URIs.
 *
 * MCP servers can advertise skill markdown files as resources whose URI starts
 * with `skill://`. This function reads those resources, parses their
 * frontmatter, and converts them into Command objects that the CLI can
 * register alongside local file-system skills.
 *
 * The function is memoized by server name so repeated calls for the same
 * connected server return cached results (callers invalidate the cache via
 * `fetchMcpSkillsForClient.cache.delete(name)` on reconnect / list-changed).
 */
export const fetchMcpSkillsForClient = memoize(
  async (client: MCPServerConnection): Promise<Command[]> => {
    if (client.type !== 'connected') return []

    try {
      if (!client.capabilities?.resources) {
        return []
      }

      const resourcesResult = await client.client.listResources()
      const skillResources = (resourcesResult.resources ?? []).filter(r =>
        r.uri.startsWith('skill://'),
      )

      if (skillResources.length === 0) return []

      const { createSkillCommand, parseSkillFrontmatterFields } =
        getMCPSkillBuilders()

      const serverPrefix = normalizeNameForMCP(client.name)
      const commands: Command[] = []

      for (const resource of skillResources) {
        try {
          const result = await client.client.readResource({ uri: resource.uri })
          const rawContent = result.contents
            ?.map(c => ('text' in c ? c.text : ''))
            .join('\n')
          if (!rawContent) continue

          const { frontmatter, content: markdownContent } = parseFrontmatter(
            rawContent,
            resource.uri,
          )
          const skillName =
            'mcp__' + serverPrefix + '__' + (resource.name ?? 'skill')
          const parsed = parseSkillFrontmatterFields(
            frontmatter,
            markdownContent,
            skillName,
          )

          commands.push(
            createSkillCommand({
              ...parsed,
              skillName,
              markdownContent,
              source: 'mcp',
              baseDir: undefined,
              loadedFrom: 'mcp',
              paths: undefined,
            }),
          )
        } catch (e) {
          logForDebugging(
            `Failed to read MCP skill resource ${resource.uri}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }

      return commands
    } catch (e) {
      logForDebugging(
        `Failed to discover MCP skills for ${client.name}: ${e instanceof Error ? e.message : String(e)}`,
      )
      return []
    }
  },
  (client: MCPServerConnection) => client.name,
)
