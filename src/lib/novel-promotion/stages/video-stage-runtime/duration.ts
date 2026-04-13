'use client'

import { countWords } from '@/lib/word-count'

const DEFAULT_DURATION_MULTIPLIER = 1
export const PANEL_VIDEO_TEXT_DURATION_MULTIPLIER = 1.0

export function normalizeDurationMultiplier(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_DURATION_MULTIPLIER
  return Math.max(0.1, Math.min(5, value as number))
}

export function applyDurationMultiplier(
  baseDuration: number | undefined,
  multiplier = DEFAULT_DURATION_MULTIPLIER,
): number | undefined {
  if (baseDuration === undefined || baseDuration <= 0) return undefined
  return Math.max(1, Math.round(baseDuration * normalizeDurationMultiplier(multiplier)))
}

export function estimatePanelDurationFromText(
  text: string | null | undefined,
  multiplier = DEFAULT_DURATION_MULTIPLIER,
): number | undefined {
  const normalizedText = typeof text === 'string' ? text.trim() : ''
  if (!normalizedText) return undefined
  const wordCount = countWords(normalizedText)
  if (wordCount <= 0) return undefined
  //6个字一秒
  const baseDuration = Math.max(2, Math.min(12, Math.ceil(wordCount / 6)))
  return applyDurationMultiplier(baseDuration, multiplier)
}

export function estimatePanelVideoDurationFromText(
  text: string | null | undefined,
): number | undefined {
  return estimatePanelDurationFromText(text, PANEL_VIDEO_TEXT_DURATION_MULTIPLIER)
}
