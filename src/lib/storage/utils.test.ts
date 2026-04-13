import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveBaseUrl, toFetchableUrl } from './utils'

describe('storage utils', () => {
  const env = process.env as Record<string, string | undefined>
  const originalEnv = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    INTERNAL_TASK_API_BASE_URL: process.env.INTERNAL_TASK_API_BASE_URL,
    NODE_ENV: process.env.NODE_ENV,
  }

  afterEach(() => {
    if (originalEnv.NEXTAUTH_URL === undefined) delete env.NEXTAUTH_URL
    else env.NEXTAUTH_URL = originalEnv.NEXTAUTH_URL

    if (originalEnv.INTERNAL_TASK_API_BASE_URL === undefined) delete env.INTERNAL_TASK_API_BASE_URL
    else env.INTERNAL_TASK_API_BASE_URL = originalEnv.INTERNAL_TASK_API_BASE_URL

    if (originalEnv.NODE_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = originalEnv.NODE_ENV

    vi.unstubAllEnvs()
  })

  it('normalizes localhost https base url for development workers', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXTAUTH_URL', 'https://localhost')

    expect(resolveBaseUrl()).toBe('http://localhost:3000')
    expect(toFetchableUrl('/api/files/images%2Fa.png')).toBe('http://localhost:3000/api/files/images%2Fa.png')
    expect(toFetchableUrl('https://localhost/api/files/images%2Fa.png')).toBe('http://localhost:3000/api/files/images%2Fa.png')
  })

  it('prefers explicit internal task api base url', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXTAUTH_URL', 'https://localhost')
    vi.stubEnv('INTERNAL_TASK_API_BASE_URL', 'http://127.0.0.1:4000')

    expect(resolveBaseUrl()).toBe('http://127.0.0.1:4000')
  })

  it('keeps non-local production urls unchanged', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', 'https://example.com')

    expect(resolveBaseUrl()).toBe('https://example.com')
  })
})
