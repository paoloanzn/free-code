export type ModifierKey = 'shift' | 'command' | 'control' | 'option'

let prewarmed = false
type NativeModifiersModule = {
  prewarm?: () => void
  isModifierPressed?: (modifier: string) => boolean
}

let nativeModifiersModule: NativeModifiersModule | null | undefined

function loadNativeModifiersModule(): NativeModifiersModule | null {
  if (process.platform !== 'darwin') {
    return null
  }

  if (nativeModifiersModule !== undefined) {
    return nativeModifiersModule
  }

  try {
    // Use local vendored stub instead of npm package (original was squatting target)
    nativeModifiersModule =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../vendor/modifiers-napi') as NativeModifiersModule) ?? null
  } catch {
    nativeModifiersModule = null
  }

  return nativeModifiersModule
}

/**
 * Pre-warm the native module by loading it in advance.
 * Call this early to avoid delay on first use.
 */
export function prewarmModifiers(): void {
  if (prewarmed || process.platform !== 'darwin') {
    return
  }
  prewarmed = true
  loadNativeModifiersModule()?.prewarm?.()
}

/**
 * Check if a specific modifier key is currently pressed (synchronous).
 */
export function isModifierPressed(modifier: ModifierKey): boolean {
  try {
    return loadNativeModifiersModule()?.isModifierPressed?.(modifier) ?? false
  } catch {
    return false
  }
}
