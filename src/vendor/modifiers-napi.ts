// Vendored stub for modifiers-napi (malicious package squatted on npm)
// Original was a native macOS module for keyboard modifier detection.
// This stub provides no-op implementations for safety.

export function prewarm(): void {
  // no-op
}

export function isModifierPressed(_modifier: string): boolean {
  return false
}
