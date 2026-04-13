/**
 * 获取用户的模型列表
 *
 * 返回用户在个人中心启用的模型，供项目配置下拉框使用。
 * capabilities 仅来自系统内置目录（不信任用户提交的 model.capabilities）。
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  composeModelKey,
  parseModelKeyStrict,
  type CapabilityValue,
  type ModelCapabilities,
  type UnifiedModelType,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { findBuiltinPricingCatalogEntry } from '@/lib/model-pricing/catalog'
import type { VideoPricingTier } from '@/lib/model-pricing/video-tier'

type StoredModelType = UnifiedModelType | string

interface StoredModel {
  modelId?: string
  modelKey?: string
  name?: string
  type?: StoredModelType
  provider?: string
}

interface StoredProvider {
  id?: string
  name?: string
  apiKey?: string
}

interface UserModelOption {
  value: string
  label: string
  provider?: string
  providerName?: string
  capabilities?: ModelCapabilities
  videoPricingTiers?: VideoPricingTier[]
}

interface UserModelsPayload {
  llm: UserModelOption[]
  image: UserModelOption[]
  video: UserModelOption[]
  audio: UserModelOption[]
  lipsync: UserModelOption[]
}

const AUDIO_MODEL_EXCLUDED_IDS = new Set([
  'qwen-voice-design',
])

function isUnifiedModelType(type: unknown): type is UnifiedModelType {
  return (
    type === 'llm'
    || type === 'image'
    || type === 'video'
    || type === 'audio'
    || type === 'lipsync'
  )
}

function toModelKey(model: StoredModel): string {
  const provider = typeof model.provider === 'string' ? model.provider.trim() : ''
  const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''

  if (provider && modelId) {
    return composeModelKey(provider, modelId)
  }

  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelKey || ''
}

function toProvider(model: StoredModel): string | undefined {
  if (typeof model.provider === 'string' && model.provider.trim()) return model.provider.trim()
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.provider || undefined
}

function toModelId(model: StoredModel): string {
  if (typeof model.modelId === 'string' && model.modelId.trim()) {
    return model.modelId.trim()
  }
  const parsed = parseModelKeyStrict(typeof model.modelKey === 'string' ? model.modelKey : '')
  return parsed?.modelId || ''
}

function toDisplayLabel(model: StoredModel, fallbackModelId: string): string {
  if (typeof model.name === 'string' && model.name.trim()) return model.name.trim()
  return fallbackModelId
}

function dedupeByModelKey(items: UserModelOption[]): UserModelOption[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.value)) return false
    seen.add(item.value)
    return true
  })
}

function cloneVideoPricingTiers(rawTiers: Array<{ when: Record<string, CapabilityValue> }>): VideoPricingTier[] {
  return rawTiers.map((tier) => ({
    when: { ...tier.when },
  }))
}

function parseStoredModels(rawModels: string | null | undefined): StoredModel[] {
  if (!rawModels) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawModels)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_PAYLOAD_INVALID',
      field: 'customModels',
    })
  }
  return parsedUnknown as StoredModel[]
}

function parseStoredProviders(rawProviders: string | null | undefined): StoredProvider[] {
  if (!rawProviders) return []
  let parsedUnknown: unknown
  try {
    parsedUnknown = JSON.parse(rawProviders)
  } catch {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  if (!Array.isArray(parsedUnknown)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROVIDER_PAYLOAD_INVALID',
      field: 'customProviders',
    })
  }
  return parsedUnknown as StoredProvider[]
}

function hasStoredProviderApiKey(provider: StoredProvider): boolean {
  return typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0
}

function getProviderKey(providerId: string): string {
  const separatorIndex = providerId.indexOf(':')
  return separatorIndex === -1 ? providerId : providerId.slice(0, separatorIndex)
}

function resolveStoredProviderByIdOrKey(
  providers: StoredProvider[],
  providerId: string,
): StoredProvider | null {
  const normalizedProviderId = providerId.trim()
  if (!normalizedProviderId) return null

  const exact = providers.find((provider) => {
    const currentId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    return currentId === normalizedProviderId
  })
  if (exact) return exact

  const providerKey = getProviderKey(normalizedProviderId)
  const candidates = providers.filter((provider) => {
    const currentId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    return currentId && getProviderKey(currentId) === providerKey
  })
  if (candidates.length !== 1) return null
  return candidates[0] || null
}

function getProviderInstanceSuffix(providerId: string): string {
  const separatorIndex = providerId.indexOf(':')
  if (separatorIndex === -1) return ''
  return providerId.slice(separatorIndex + 1).trim()
}

function buildProviderDisplayName(input: {
  providerId: string
  providerName?: string
  duplicateNameCount: number
}): string {
  const baseName = typeof input.providerName === 'string' && input.providerName.trim()
    ? input.providerName.trim()
    : input.providerId
  const instanceSuffix = getProviderInstanceSuffix(input.providerId)
  if (!instanceSuffix) return baseName
  if (input.duplicateNameCount <= 1) return baseName
  return `${baseName} [${instanceSuffix.slice(0, 8)}]`
}

function isUserSelectableModel(model: StoredModel): boolean {
  if (model.type !== 'audio') return true
  const modelId = toModelId(model)
  return !AUDIO_MODEL_EXCLUDED_IDS.has(modelId)
}

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const pref = await prisma.userPreference.findUnique({
    where: { userId },
    select: { customModels: true, customProviders: true },
  })

  const modelsRaw: StoredModel[] = parseStoredModels(pref?.customModels)
  const providers: StoredProvider[] = parseStoredProviders(pref?.customProviders)

  const providerNameMap = new Map<string, string>()
  const providerBaseNameCount = new Map<string, number>()
  const providerIdsWithApiKey = new Set<string>()
  providers.forEach((provider) => {
    const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    if (!providerId) return

    const storedName = typeof provider.name === 'string' ? provider.name.trim() : ''
    const baseName = storedName || getProviderKey(providerId) || providerId
    providerBaseNameCount.set(baseName, (providerBaseNameCount.get(baseName) || 0) + 1)
    if (hasStoredProviderApiKey(provider)) providerIdsWithApiKey.add(providerId)
  })

  providers.forEach((provider) => {
    const providerId = typeof provider?.id === 'string' ? provider.id.trim() : ''
    if (!providerId) return

    const storedName = typeof provider.name === 'string' ? provider.name.trim() : ''
    const baseName = storedName || getProviderKey(providerId) || providerId
    providerNameMap.set(providerId, buildProviderDisplayName({
      providerId,
      providerName: storedName || undefined,
      duplicateNameCount: providerBaseNameCount.get(baseName) || 1,
    }))
  })

  const grouped: UserModelsPayload = {
    llm: [],
    image: [],
    video: [],
    audio: [],
    lipsync: [],
  }

  for (const model of modelsRaw) {
    if (!isUnifiedModelType(model.type)) continue
    if (!isUserSelectableModel(model)) continue

    const modelType = model.type
    const modelKey = toModelKey(model)
    if (!modelKey) continue

    const provider = toProvider(model)
    if (!provider) continue
    const matchedProvider = resolveStoredProviderByIdOrKey(providers, provider)
    if (!matchedProvider) continue
    const matchedProviderId = typeof matchedProvider.id === 'string' ? matchedProvider.id.trim() : ''
    if (!matchedProviderId || !providerIdsWithApiKey.has(matchedProviderId)) continue
    const modelId = toModelId(model)
    const option: UserModelOption = {
      value: modelKey,
      label: toDisplayLabel(model, modelId || modelKey),
      provider,
      providerName: providerNameMap.get(matchedProviderId),
    }

    if (provider && modelId) {
      const capabilities = findBuiltinCapabilities(modelType, provider, modelId)
      if (capabilities) {
        option.capabilities = capabilities
      }

      if (modelType === 'video') {
        const pricingEntry = findBuiltinPricingCatalogEntry('video', provider, modelId)
        if (pricingEntry?.pricing.mode === 'capability' && Array.isArray(pricingEntry.pricing.tiers)) {
          option.videoPricingTiers = cloneVideoPricingTiers(pricingEntry.pricing.tiers)
        }
      }
    }

    grouped[modelType].push(option)
  }

  return NextResponse.json({
    llm: dedupeByModelKey(grouped.llm),
    image: dedupeByModelKey(grouped.image),
    video: dedupeByModelKey(grouped.video),
    audio: dedupeByModelKey(grouped.audio),
    lipsync: dedupeByModelKey(grouped.lipsync),
  } satisfies UserModelsPayload)
})
