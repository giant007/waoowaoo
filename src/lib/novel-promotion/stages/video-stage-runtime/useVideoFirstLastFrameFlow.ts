'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { countWords } from '@/lib/word-count'
import type {
  VideoGenerationOptions,
  VideoModelOption,
  VideoPanel,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import {
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { supportsFirstLastFrame } from '@/lib/model-capabilities/video-model-options'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'

interface FirstLastFrameCapabilityField {
  field: string
  label: string
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
  value: VideoGenerationOptionValue | undefined
}

type VideoGenerationOptionValue = string | number | boolean

function parseByOptionType(
  input: string,
  sample: VideoGenerationOptionValue,
): VideoGenerationOptionValue {
  if (typeof sample === 'number') return Number(input)
  if (typeof sample === 'boolean') return input === 'true'
  return input
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

function estimateDurationFromSourceText(text: string | undefined): number | undefined {
  const normalizedText = typeof text === 'string' ? text.trim() : ''
  if (!normalizedText) return undefined
  const wordCount = countWords(normalizedText)
  if (wordCount <= 0) return undefined
  return Math.max(2, Math.min(12, Math.ceil(wordCount / 8)))
}

function getPanelPlaybackDuration(panel: VideoPanel | null | undefined): number | undefined {
  if (!panel) return undefined
  return panel.textPanel?.duration
    ?? estimateDurationFromSourceText(panel.textPanel?.text_segment || panel.textPanel?.description)
}

function getPanelKey(panel: VideoPanel | null | undefined): string | null {
  if (!panel) return null
  return `${panel.storyboardId}-${panel.panelIndex}`
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

function toCapabilityFields(
  definitions: ReturnType<typeof resolveEffectiveVideoCapabilityDefinitions>,
  effectiveFields: ReturnType<typeof resolveEffectiveVideoCapabilityFields>,
): FirstLastFrameCapabilityField[] {
  const effectiveFieldMap = new Map(effectiveFields.map((field) => [field.field, field]))
  return definitions.map((definition) => {
    const effectiveField = effectiveFieldMap.get(definition.field)
    const enabledOptions = effectiveField?.options ?? []
    return {
      field: definition.field,
      label: toFieldLabel(definition.field),
      options: definition.options as VideoGenerationOptionValue[],
      disabledOptions: (definition.options as VideoGenerationOptionValue[])
        .filter((option) => !enabledOptions.includes(option)),
      value: effectiveField?.value as VideoGenerationOptionValue | undefined,
    }
  })
}

interface UseVideoFirstLastFrameFlowParams {
  allPanels: VideoPanel[]
  linkedPanels: Map<string, boolean>
  videoModelOptions: VideoModelOption[]
  onGenerateVideo: (
    storyboardId: string,
    panelIndex: number,
    videoModel?: string,
    firstLastFrame?: {
      lastFrameStoryboardId: string
      lastFramePanelIndex: number
      flModel: string
      customPrompt?: string
    },
    generationOptions?: VideoGenerationOptions,
    panelId?: string,
  ) => Promise<void>
  t: (key: string) => string
}

export function useVideoFirstLastFrameFlow({
  allPanels,
  linkedPanels,
  videoModelOptions,
  onGenerateVideo,
  t,
}: UseVideoFirstLastFrameFlowParams) {
  const firstLastFrameModelOptions = useMemo(
    () => videoModelOptions.filter((option) => supportsFirstLastFrame(option)),
    [videoModelOptions],
  )
  const [flModel, setFlModel] = useState(firstLastFrameModelOptions[0]?.value || '')
  const [flGenerationOptions, setFlGenerationOptions] = useState<VideoGenerationOptions>({})
  const [flCustomPrompts, setFlCustomPrompts] = useState<Map<string, string>>(new Map())
  const [isDurationManuallyPinned, setIsDurationManuallyPinned] = useState(false)

  useEffect(() => {
    setFlCustomPrompts((previous) => {
      const next = new Map(previous)
      const existingPanelKeys = new Set<string>()

      for (const panel of allPanels) {
        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        existingPanelKeys.add(panelKey)
        if (!next.has(panelKey)) {
          next.set(panelKey, panel.firstLastFramePrompt || '')
        }
      }

      for (const key of next.keys()) {
        if (!existingPanelKeys.has(key)) next.delete(key)
      }

      return next
    })
  }, [allPanels])

  useEffect(() => {
    if (!flModel && firstLastFrameModelOptions.length > 0) {
      setFlModel(firstLastFrameModelOptions[0].value)
      return
    }
    if (flModel && !firstLastFrameModelOptions.some((option) => option.value === flModel)) {
      setFlModel(firstLastFrameModelOptions[0]?.value || '')
    }
  }, [firstLastFrameModelOptions, flModel])

  const selectedFlModelOption = useMemo(
    () => firstLastFrameModelOptions.find((option) => option.value === flModel),
    [firstLastFrameModelOptions, flModel],
  )
  const flPricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedFlModelOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'firstlastframe',
      },
    }),
    [selectedFlModelOption?.videoPricingTiers],
  )
  const flCapabilityDefinitions = useMemo(
    () => resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedFlModelOption?.capabilities?.video,
      pricingTiers: flPricingTiers,
    }),
    [flPricingTiers, selectedFlModelOption?.capabilities?.video],
  )

  useEffect(() => {
    setFlGenerationOptions((previous) => {
      return normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: previous,
      })
    })
  }, [flCapabilityDefinitions, flPricingTiers])

  const resolveFlGenerationOptionsForPair = useCallback((
    firstPanel?: VideoPanel | null,
    lastPanel?: VideoPanel | null,
    baseSelection?: VideoGenerationOptions,
  ): VideoGenerationOptions => {
    const normalizedSelection = normalizeVideoGenerationSelections({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: baseSelection ?? flGenerationOptions,
    })

    if (isDurationManuallyPinned) {
      return normalizedSelection
    }

    const currentDuration = getPanelPlaybackDuration(firstPanel) ?? 0
    const lastPanelKey = getPanelKey(lastPanel)
    const shouldMergeLastFrameDuration = !!lastPanel && !(lastPanelKey ? linkedPanels.get(lastPanelKey) : false)
    const lastDuration = shouldMergeLastFrameDuration
      ? (getPanelPlaybackDuration(lastPanel) ?? 0)
      : 0
    const totalDuration = currentDuration + lastDuration

    if (totalDuration <= 0) {
      return normalizedSelection
    }

    const effectiveFields = resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: normalizedSelection,
    })
    const durationField = effectiveFields.find((field) => field.field === 'duration')
    const nearestDuration = durationField
      ? pickNearestNumberOption(durationField.options as VideoGenerationOptionValue[], totalDuration)
      : undefined

    if (nearestDuration === undefined) {
      return normalizedSelection
    }

    return normalizeVideoGenerationSelections({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: {
        ...normalizedSelection,
        duration: nearestDuration,
      },
      pinnedFields: ['duration'],
    })
  }, [
    flCapabilityDefinitions,
    flGenerationOptions,
    flPricingTiers,
    isDurationManuallyPinned,
    linkedPanels,
  ])

  const flEffectiveCapabilityFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: flGenerationOptions,
    }),
    [flCapabilityDefinitions, flGenerationOptions, flPricingTiers],
  )
  const flDefinitionFieldMap = useMemo(
    () => new Map(flCapabilityDefinitions.map((definition) => [definition.field, definition])),
    [flCapabilityDefinitions],
  )

  const flCapabilityFields: FirstLastFrameCapabilityField[] = useMemo(() => {
    return toCapabilityFields(flCapabilityDefinitions, flEffectiveCapabilityFields)
  }, [flCapabilityDefinitions, flEffectiveCapabilityFields])

  const flMissingCapabilityFields = useMemo(
    () => flEffectiveCapabilityFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [flEffectiveCapabilityFields],
  )

  const setFlCapabilityValue = useCallback((field: string, rawValue: string) => {
    const definitionField = flDefinitionFieldMap.get(field)
    if (!definitionField || definitionField.options.length === 0) return
    const parsedValue = parseByOptionType(rawValue, definitionField.options[0])
    if (!definitionField.options.includes(parsedValue)) return
    if (field === 'duration') {
      setIsDurationManuallyPinned(true)
    }
    setFlGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: flCapabilityDefinitions,
        pricingTiers: flPricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
        },
        pinnedFields: [field],
      }),
    }))
  }, [flCapabilityDefinitions, flDefinitionFieldMap, flPricingTiers])

  const setFlCustomPrompt = useCallback((panelKey: string, value: string) => {
    setFlCustomPrompts((previous) => new Map(previous).set(panelKey, value))
  }, [])

  const resetFlCustomPrompt = useCallback((panelKey: string) => {
    setFlCustomPrompts((previous) => {
      const next = new Map(previous)
      next.delete(panelKey)
      return next
    })
  }, [])

  const handleGenerateFirstLastFrame = useCallback(async (
    firstStoryboardId: string,
    firstPanelIndex: number,
    lastStoryboardId: string,
    lastPanelIndex: number,
    panelKey: string,
    generationOptions?: VideoGenerationOptions,
    firstPanelId?: string,
  ) => {
    const firstPanel = allPanels.find(
      (panel) =>
        panel.storyboardId === firstStoryboardId
        && panel.panelIndex === firstPanelIndex,
    )
    const lastPanel = allPanels.find(
      (panel) =>
        panel.storyboardId === lastStoryboardId
        && panel.panelIndex === lastPanelIndex,
    )
    const persistedCustomPrompt = allPanels.find(
      (panel) =>
        panel.storyboardId === firstStoryboardId
        && panel.panelIndex === firstPanelIndex,
    )?.firstLastFramePrompt
    const customPrompt = flCustomPrompts.get(panelKey) ?? persistedCustomPrompt

    const resolvedGenerationOptions = resolveFlGenerationOptionsForPair(
      firstPanel,
      lastPanel,
      generationOptions ?? flGenerationOptions,
    )

    await onGenerateVideo(firstStoryboardId, firstPanelIndex, flModel, {
      lastFrameStoryboardId: lastStoryboardId,
      lastFramePanelIndex: lastPanelIndex,
      flModel,
      customPrompt,
    }, resolvedGenerationOptions, firstPanelId)
  }, [
    allPanels,
    flCustomPrompts,
    flGenerationOptions,
    flModel,
    onGenerateVideo,
    resolveFlGenerationOptionsForPair,
  ])

  const getFlConfigurationForPair = useCallback((
    firstPanel?: VideoPanel | null,
    lastPanel?: VideoPanel | null,
  ) => {
    const generationOptions = resolveFlGenerationOptionsForPair(firstPanel, lastPanel)
    const effectiveFields = resolveEffectiveVideoCapabilityFields({
      definitions: flCapabilityDefinitions,
      pricingTiers: flPricingTiers,
      selection: generationOptions,
    })

    return {
      generationOptions,
      capabilityFields: toCapabilityFields(flCapabilityDefinitions, effectiveFields),
      missingCapabilityFields: effectiveFields
        .filter((field) => field.options.length === 0 || field.value === undefined)
        .map((field) => field.field),
    }
  }, [flCapabilityDefinitions, flPricingTiers, resolveFlGenerationOptionsForPair])

  const getDefaultFlPrompt = useCallback((firstPrompt?: string, lastPrompt?: string): string => {
    const first = firstPrompt || ''
    const last = lastPrompt || ''
    if (last) {
      return `${first} ${t('firstLastFrame.thenTransitionTo')}: ${last}`
    }
    return first
  }, [t])

  const getNextPanel = useCallback((currentIndex: number): VideoPanel | null => {
    if (currentIndex >= allPanels.length - 1) return null
    return allPanels[currentIndex + 1]
  }, [allPanels])

  const isLinkedAsLastFrame = useCallback((currentIndex: number): boolean => {
    if (currentIndex === 0) return false
    const previousPanel = allPanels[currentIndex - 1]
    const previousKey = `${previousPanel.storyboardId}-${previousPanel.panelIndex}`
    return linkedPanels.get(previousKey) || false
  }, [allPanels, linkedPanels])

  return {
    flModel,
    flModelOptions: firstLastFrameModelOptions,
    flGenerationOptions,
    flCapabilityFields,
    flMissingCapabilityFields,
    flCustomPrompts,
    setFlModel,
    setFlCapabilityValue,
    setFlCustomPrompt,
    resetFlCustomPrompt,
    handleGenerateFirstLastFrame,
    getFlConfigurationForPair,
    getDefaultFlPrompt,
    getNextPanel,
    isLinkedAsLastFrame,
  }
}
