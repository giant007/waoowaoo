import { logDebug as _ulogDebug, logError as _ulogError } from '@/lib/logging/core'
import Redis from 'ioredis'

type RedisSingleton = {
  app?: Redis
  queue?: Redis
}

const globalForRedis = globalThis as typeof globalThis & {
  __waoowaooRedis?: RedisSingleton
}

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1'
const REDIS_PORT = Number.parseInt(process.env.REDIS_PORT || '6379', 10) || 6379
const REDIS_USERNAME = process.env.REDIS_USERNAME
const REDIS_PASSWORD = process.env.REDIS_PASSWORD
const REDIS_TLS = process.env.REDIS_TLS === 'true'
const IS_TEST_ENV = process.env.NODE_ENV === 'test'
const IS_BUILD_ENV =
  process.env.NEXT_PHASE === 'phase-production-build'
  || process.env.NEXT_BUILD === 'true'
  || process.env.REDIS_DISABLED === 'true'
  || process.env.SKIP_REDIS === 'true'

function buildBaseConfig() {
  return {
    host: REDIS_HOST,
    port: REDIS_PORT,
    username: REDIS_USERNAME,
    password: REDIS_PASSWORD,
    tls: REDIS_TLS ? {} : undefined,
    enableReadyCheck: !IS_BUILD_ENV,
    lazyConnect: IS_TEST_ENV || IS_BUILD_ENV,
    retryStrategy(times: number) {
      // Exponential backoff capped at 30s.
      return Math.min(2 ** Math.min(times, 10) * 100, 30_000)
    },
  }
}

function onConnectLog(scope: string, client: Redis) {
  client.on('connect', () => _ulogDebug(`[Redis:${scope}] connected ${REDIS_HOST}:${REDIS_PORT}`))
  client.on('error', (err) => _ulogError(`[Redis:${scope}] error:`, err.message))
}

function createRedisClient(params: { scope: string; maxRetriesPerRequest: number | null }) {
  if (IS_BUILD_ENV) {
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: () => async () => null,
    }
    return new Proxy({}, handler) as unknown as Redis
  }

  const client = new Redis({
    ...buildBaseConfig(),
    maxRetriesPerRequest: params.maxRetriesPerRequest,
  })
  onConnectLog(params.scope, client)
  return client
}

function createAppRedis() {
  return createRedisClient({ scope: 'app', maxRetriesPerRequest: 2 })
}

function createQueueRedis() {
  // BullMQ requires null to avoid command retry side effects.
  return createRedisClient({ scope: 'queue', maxRetriesPerRequest: null })
}

const singleton = globalForRedis.__waoowaooRedis || {}
if (!globalForRedis.__waoowaooRedis) {
  globalForRedis.__waoowaooRedis = singleton
}

export const redis = singleton.app || (singleton.app = createAppRedis())
export const queueRedis = singleton.queue || (singleton.queue = createQueueRedis())

export function createSubscriber() {
  return createRedisClient({ scope: 'sub', maxRetriesPerRequest: null })
}
