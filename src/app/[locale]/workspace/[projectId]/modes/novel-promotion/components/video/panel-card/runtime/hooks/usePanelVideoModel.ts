import { useEffect, useMemo, useState } from 'react'
import type { VideoModelOption, VideoGenerationOptionValue, VideoGenerationOptions } from '../../../types'
import type { CapabilitySelections } from '@/lib/model-config-contract'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import { estimatePanelVideoDurationFromText } from '@/lib/novel-promotion/stages/video-stage-runtime/duration'

interface UsePanelVideoModelParams {
  defaultVideoModel: string
  capabilityOverrides?: CapabilitySelections
  userVideoModels?: VideoModelOption[]
  sourceText?: string
  estimatedDuration?: number
  persistenceKey?: string
}

interface CapabilityField {
  field: string
  label: string
  labelKey?: string
  unitKey?: string
  optionLabelKeys?: Record<string, string>
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
  value: VideoGenerationOptionValue | undefined
}

interface PersistedSelectionState {
  selection: VideoGenerationOptions
  manualFields: Set<string>
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function parseByOptionType(
  input: string,
  sample: VideoGenerationOptionValue,
): VideoGenerationOptionValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isGenerationOptionValue(value: unknown): value is VideoGenerationOptionValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function readSelectionForModel(
  capabilityOverrides: CapabilitySelections | undefined,
  modelKey: string,
): VideoGenerationOptions {
  if (!modelKey || !capabilityOverrides) return {}
  const rawSelection = capabilityOverrides[modelKey]
  if (!isRecord(rawSelection)) return {}

  const selection: VideoGenerationOptions = {}
  for (const [field, value] of Object.entries(rawSelection)) {
    if (field === 'aspectRatio') continue
    if (!isGenerationOptionValue(value)) continue
    selection[field] = value
  }
  return selection
}

function omitDuration(selection: VideoGenerationOptions): VideoGenerationOptions {
  const { duration: _duration, ...rest } = selection
  return rest
}

function pickNearestNumberOption(
  options: VideoGenerationOptionValue[],
  target: number,
): number | undefined {
  const numericOptions = options.filter((option): option is number => typeof option === 'number')
  if (numericOptions.length === 0) return undefined
  return numericOptions.reduce((best, current) => {
    const currentDistance = Math.abs(current - target)
    const bestDistance = Math.abs(best - target)
    if (currentDistance !== bestDistance) {
      return currentDistance < bestDistance ? current : best
    }
    return current < best ? current : best
  })
}

function buildPersistenceStorageKey(baseKey: string, modelKey: string): string {
  return `video-panel-generation-options:${baseKey}:${modelKey}`
}

function readPersistedSelection(
  baseKey: string | undefined,
  modelKey: string,
): PersistedSelectionState | null {
  if (!baseKey || !modelKey || typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(buildPersistenceStorageKey(baseKey, modelKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return null

    const manualFields = new Set<string>()
    const selection: VideoGenerationOptions = {}

    if (isRecord(parsed.selection)) {
      for (const [field, value] of Object.entries(parsed.selection)) {
        if (isGenerationOptionValue(value)) {
          selection[field] = value
        }
      }

      const rawManualFields = Array.isArray(parsed.manualFields) ? parsed.manualFields : []
      for (const field of rawManualFields) {
        if (typeof field === 'string' && field.trim()) {
          manualFields.add(field)
        }
      }
      return { selection, manualFields }
    }

    for (const [field, value] of Object.entries(parsed)) {
      if (isGenerationOptionValue(value)) {
        selection[field] = value
      }
    }

    delete selection.duration
    return { selection, manualFields }
  } catch {
    return null
  }
}

function writePersistedSelection(
  baseKey: string | undefined,
  modelKey: string,
  selection: VideoGenerationOptions,
  manualFields: Iterable<string>,
) {
  if (!baseKey || !modelKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      buildPersistenceStorageKey(baseKey, modelKey),
      JSON.stringify({
        version: 2,
        selection,
        manualFields: Array.from(new Set(Array.from(manualFields).filter((field) => !!field))),
      }),
    )
  } catch {
    // Ignore storage errors in client runtime.
  }
}

export function usePanelVideoModel({
  defaultVideoModel,
  capabilityOverrides,
  userVideoModels,
  sourceText,
  estimatedDuration: preferredDuration,
  persistenceKey,
}: UsePanelVideoModelParams) {
  const [selectedModel, setSelectedModel] = useState(defaultVideoModel || '')
  const [generationOptions, setGenerationOptions] = useState<VideoGenerationOptions>(() =>
    readSelectionForModel(capabilityOverrides, defaultVideoModel || ''),
  )
  const videoModelOptions = userVideoModels ?? []
  const selectedOption = videoModelOptions.find((option) => option.value === selectedModel)
  const pricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'normal',
      },
    }),
    [selectedOption?.videoPricingTiers],
  )

  useEffect(() => {
    setSelectedModel(defaultVideoModel || '')
  }, [defaultVideoModel])

  useEffect(() => {
    if (!selectedModel) {
      if (videoModelOptions.length > 0) {
        setSelectedModel(videoModelOptions[0].value)
      }
      return
    }
    if (videoModelOptions.some((option) => option.value === selectedModel)) return
    setSelectedModel(videoModelOptions[0]?.value || '')
  }, [selectedModel, videoModelOptions])

  const capabilityDefinitions = useMemo(
    () => resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedOption?.capabilities?.video,
      pricingTiers,
    }),
    [pricingTiers, selectedOption?.capabilities?.video],
  )

  const selectedModelOverrides = useMemo(
    () => readSelectionForModel(capabilityOverrides, selectedModel),
    [capabilityOverrides, selectedModel],
  )
  const selectedModelOverridesSignature = useMemo(
    () => JSON.stringify(selectedModelOverrides),
    [selectedModelOverrides],
  )
  const estimatedDuration = useMemo(
    () => {
      const narrationDuration = estimatePanelVideoDurationFromText(sourceText)
     
      if (narrationDuration !== undefined) return narrationDuration
      return preferredDuration
    },
    [preferredDuration, sourceText],
  )

  useEffect(() => {
    const persistedSelection = readPersistedSelection(persistenceKey, selectedModel)
    const normalizedBaseSelection = omitDuration(selectedModelOverrides)
    const normalizedSelection = normalizeVideoGenerationSelections({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: persistedSelection
        ? { ...normalizedBaseSelection, ...persistedSelection.selection }
        : normalizedBaseSelection,
    })

    if (persistedSelection?.manualFields.has('duration') || estimatedDuration === undefined) {
      setGenerationOptions(normalizedSelection)
      return
    }

    const effectiveFields = resolveEffectiveVideoCapabilityFields({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: normalizedSelection,
    })
    const durationField = effectiveFields.find((field) => field.field === 'duration')
    const nearestDuration = durationField
      ? pickNearestNumberOption(durationField.options as VideoGenerationOptionValue[], estimatedDuration)
      : undefined

    if (nearestDuration === undefined) {
      setGenerationOptions(normalizedSelection)
      return
    }

    setGenerationOptions(normalizeVideoGenerationSelections({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: {
        ...normalizedSelection,
        duration: nearestDuration,
      },
      pinnedFields: ['duration'],
    }))
  }, [
    selectedModel,
    selectedModelOverridesSignature,
    capabilityDefinitions,
    pricingTiers,
    selectedModelOverrides,
    estimatedDuration,
    persistenceKey,
  ])

  useEffect(() => {
    setGenerationOptions((previous) => normalizeVideoGenerationSelections({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: previous,
    }))
  }, [capabilityDefinitions, pricingTiers])

  const effectiveFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: capabilityDefinitions,
      pricingTiers,
      selection: generationOptions,
    }),
    [capabilityDefinitions, generationOptions, pricingTiers],
  )
  const missingCapabilityFields = useMemo(
    () => effectiveFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [effectiveFields],
  )
  const effectiveFieldMap = useMemo(
    () => new Map(effectiveFields.map((field) => [field.field, field])),
    [effectiveFields],
  )
  const definitionFieldMap = useMemo(
    () => new Map(capabilityDefinitions.map((definition) => [definition.field, definition])),
    [capabilityDefinitions],
  )
  const capabilityFields: CapabilityField[] = useMemo(() => {
    return capabilityDefinitions.map((definition) => {
      const effectiveField = effectiveFieldMap.get(definition.field)
      const enabledOptions = effectiveField?.options ?? []
      return {
        field: definition.field,
        label: toFieldLabel(definition.field),
        labelKey: definition.fieldI18n?.labelKey,
        unitKey: definition.fieldI18n?.unitKey,
        optionLabelKeys: definition.fieldI18n?.optionLabelKeys,
        options: definition.options as VideoGenerationOptionValue[],
        disabledOptions: (definition.options as VideoGenerationOptionValue[])
          .filter((option) => !enabledOptions.includes(option)),
        value: effectiveField?.value as VideoGenerationOptionValue | undefined,
      }
    })
  }, [capabilityDefinitions, effectiveFieldMap])

  const setCapabilityValue = (field: string, rawValue: string) => {
    const definitionField = definitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return
    setGenerationOptions((previous) => {
      const next = {
        ...normalizeVideoGenerationSelections({
          definitions: capabilityDefinitions,
          pricingTiers,
          selection: {
            ...previous,
            [field]: parsedValue,
          },
          pinnedFields: [field],
        }),
      }
      const persistedSelection = readPersistedSelection(persistenceKey, selectedModel)
      const manualFields = new Set(persistedSelection?.manualFields ?? [])
      manualFields.add(field)
      writePersistedSelection(persistenceKey, selectedModel, next, manualFields)
      return next
    })
  }

  return {
    selectedModel,
    setSelectedModel,
    generationOptions,
    capabilityFields,
    setCapabilityValue,
    missingCapabilityFields,
    videoModelOptions,
  }
}
