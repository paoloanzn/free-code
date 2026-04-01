/**
 * Watch the terminal's background color via periodic OSC 11 queries and
 * notify when the resolved dark/light theme changes. Used by ThemeProvider
 * when the user selects the 'auto' theme.
 *
 * The watcher sends an OSC 11 query on start and then at a fixed interval.
 * Each response is parsed into a SystemTheme ('dark' | 'light') using the
 * luminance helper in systemTheme.ts; the callback fires only on change.
 */

import type { TerminalQuerier } from '../ink/terminal-querier.js'
import { oscColor } from '../ink/terminal-querier.js'
import {
  setCachedSystemTheme,
  themeFromOscColor,
  type SystemTheme,
} from './systemTheme.js'

/** How often (ms) to re-query the terminal background color. */
const POLL_INTERVAL_MS = 5_000

/**
 * Start watching the terminal background color for theme changes.
 *
 * @param querier - The TerminalQuerier used to send OSC queries and receive
 *   responses via the shared stdin pipeline.
 * @param callback - Invoked with the new SystemTheme whenever it changes.
 * @returns A cleanup function that stops the watcher, or undefined if the
 *   querier is unavailable.
 */
export function watchSystemTheme(
  querier: TerminalQuerier | null,
  callback: (theme: SystemTheme) => void,
): (() => void) | undefined {
  if (!querier) return undefined

  let lastTheme: SystemTheme | undefined
  let stopped = false

  async function poll(): Promise<void> {
    if (stopped) return
    try {
      const [response] = await Promise.all([
        querier!.send(oscColor(11)),
        querier!.flush(),
      ])
      if (stopped) return
      if (response) {
        const theme = themeFromOscColor(response.data)
        if (theme && theme !== lastTheme) {
          lastTheme = theme
          setCachedSystemTheme(theme)
          callback(theme)
        }
      }
    } catch {
      // Terminal didn't respond or query failed — silently ignore.
    }
  }

  // Fire the first poll immediately.
  void poll()

  const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)

  return () => {
    stopped = true
    clearInterval(timer)
  }
}
