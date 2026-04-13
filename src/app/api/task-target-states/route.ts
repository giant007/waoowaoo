import { NextRequest, NextResponse } from 'next/server'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  isErrorResponse,
  requireProjectAuthLight,
  requireUserAuth} from '@/lib/api-auth'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { queryTaskTargetStates, type TaskTargetQuery } from '@/lib/task/state-service'

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

function buildServerTiming(params: {
  jsonMs: number
  authMs: number
  queryMs: number
  totalMs: number
}) {
  const format = (value: number) => value.toFixed(2)
  return [
    `json;dur=${format(params.jsonMs)}`,
    `auth;dur=${format(params.authMs)}`,
    `query;dur=${format(params.queryMs)}`,
    `total;dur=${format(params.totalMs)}`,
  ].join(', ')
}

function normalizeTarget(input: unknown): TaskTargetQuery {
  const payload = input as Record<string, unknown>
  const targetType = typeof payload.targetType === 'string' ? payload.targetType.trim() : ''
  const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : ''
  const types = Array.isArray(payload.types)
    ? payload.types.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined

  if (!targetType || !targetId) {
    throw new ApiError('INVALID_PARAMS')
  }

  return {
    targetType,
    targetId,
    ...(types && types.length > 0 ? { types } : {})}
}

export const POST = apiHandler(async (request: NextRequest) => {
  const requestStartedAt = nowMs()
  const jsonStartedAt = nowMs()
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }
  const jsonMs = nowMs() - jsonStartedAt
  const projectId = typeof body?.projectId === 'string' ? body.projectId.trim() : ''
  const targetsRaw = Array.isArray(body?.targets) ? body.targets : null

  if (!projectId || !targetsRaw) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (targetsRaw.length > 500) {
    throw new ApiError('INVALID_PARAMS')
  }

  const targets = targetsRaw.map(normalizeTarget)

  if (targets.length === 0) {
    const totalMs = nowMs() - requestStartedAt
    const response = NextResponse.json({ states: [] })
    response.headers.set(
      'Server-Timing',
      buildServerTiming({
        jsonMs,
        authMs: 0,
        queryMs: 0,
        totalMs,
      }),
    )
    return response
  }

  const authStartedAt = nowMs()
  let userId: string
  if (projectId === 'global-asset-hub') {
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    userId = authResult.session.user.id
  } else {
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    userId = authResult.session.user.id
  }
  const authMs = nowMs() - authStartedAt

  const queryStartedAt = nowMs()
  const states = await withPrismaRetry(() =>
    queryTaskTargetStates({
      projectId,
      userId,
      targets})
  )
  const queryMs = nowMs() - queryStartedAt
  const totalMs = nowMs() - requestStartedAt

  const response = NextResponse.json({ states })
  response.headers.set(
    'Server-Timing',
    buildServerTiming({
      jsonMs,
      authMs,
      queryMs,
      totalMs,
    }),
  )
  return response
})
