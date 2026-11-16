import { describe, expect, test } from 'claude-code/testing'

import { firstAppleLanguage, langOf, pickLang, STRINGS, statusLabel } from './i18n'

describe('language', () => {
  test('locale tags', () => {
    expect(langOf('zh-Hans-CN')).toBe('zh')
    expect(langOf('zh_TW.UTF-8')).toBe('zh')
    expect(langOf('en_US.UTF-8')).toBe('en')
    expect(langOf('ja-JP')).toBe('en')
    expect(langOf('C')).toBeNull()
    expect(langOf('C.UTF-8')).toBeNull()
    expect(langOf('')).toBeNull()
  })

  test('macOS AppleLanguages output', () => {
    expect(firstAppleLanguage('(\n    "zh-Hans-CN",\n    "en-CN"\n)\n')).toBe('zh-Hans-CN')
    expect(firstAppleLanguage('(\n    en,\n    "zh-Hans"\n)')).toBe('en')
    expect(firstAppleLanguage('')).toBeNull()
  })

  test('setting, then system language, then LC_ALL / LC_MESSAGES / LANG, then runtime', () => {
    // A Chinese macOS with an English terminal locale shows Chinese.
    expect(pickLang('auto', { system: 'zh-Hans-CN', env: [undefined, undefined, 'en_US.UTF-8'] })).toBe('zh')
    expect(pickLang('en', { system: 'zh-Hans-CN', env: [] })).toBe('en')
    expect(pickLang('auto', { system: null, env: ['', 'zh_CN.UTF-8', 'en_US.UTF-8'] })).toBe('zh')
    expect(pickLang('auto', { system: null, env: [undefined, undefined, 'C'], runtime: 'zh-CN' })).toBe('zh')
    expect(pickLang(undefined, { env: [] })).toBe('en')
  })

  test('status labels keep their suffix', () => {
    expect(statusLabel(STRINGS.en, '待验证', '待验证✗验证失败')).toBe('To verify✗验证失败')
    expect(statusLabel(STRINGS.zh, '待验证', '待验证✗验证失败')).toBe('待验证✗验证失败')
    expect(statusLabel(STRINGS.en, '自定义', '')).toBe('自定义')
  })

  test('both tables say the same things', () => {
    expect(Object.keys(STRINGS.en).sort()).toEqual(Object.keys(STRINGS.zh).sort())
    expect(STRINGS.en.toast({ id: 'T-1', kind: 'new', status: '待决策', title: 'x' })).toBe('Task Pipeline: T-1 added as Decision: x')
  })
})
