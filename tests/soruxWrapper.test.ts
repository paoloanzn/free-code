import { describe, expect, test } from 'bun:test'

import {
  renderSoruxWrapper,
  updateSoruxWrapperContent,
} from '../src/utils/soruxWrapper.js'

describe('renderSoruxWrapper', () => {
  test('uses absolute binary paths and preserves caller cwd', () => {
    const wrapper = renderSoruxWrapper('F:\\freecode\\free-code')
    expect(wrapper).toContain('set "FREECODE_ROOT=F:\\freecode\\free-code"')
    expect(wrapper).not.toContain('cd /d "%FREECODE_ROOT%"')
    expect(wrapper).toContain('if exist "%FREECODE_ROOT%\\cli.exe"')
    expect(wrapper).toContain('"%FREECODE_ROOT%\\cli.exe" %*')
  })
})

describe('updateSoruxWrapperContent', () => {
  test('updates repo root and removes forced cd while preserving auth env', () => {
    const existing = `@echo off
setlocal

set "FREECODE_ROOT=F:\\old"
set "OPENAI_API_KEY=abc"
set "OPENAI_BASE_URL=https://example.com"

cd /d "%FREECODE_ROOT%"

if exist ".\\cli.exe" (
  ".\\cli.exe" --model gpt-5.3-codex %*
  exit /b %errorlevel%
) else if exist ".\\cli-dev.exe" (
  ".\\cli-dev.exe" --model gpt-5.3-codex %*
  exit /b %errorlevel%
)
`

    const updated = updateSoruxWrapperContent(
      existing,
      'F:\\freecode\\free-code',
    )

    expect(updated).toContain('set "FREECODE_ROOT=F:\\freecode\\free-code"')
    expect(updated).toContain('set "OPENAI_API_KEY=abc"')
    expect(updated).not.toContain('cd /d "%FREECODE_ROOT%"')
    expect(updated).toContain('if exist "%FREECODE_ROOT%\\cli.exe"')
    expect(updated).toContain('"%FREECODE_ROOT%\\cli-dev.exe" --model gpt-5.3-codex %*')
  })
})
