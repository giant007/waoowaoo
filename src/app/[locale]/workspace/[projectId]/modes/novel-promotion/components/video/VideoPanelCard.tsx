'use client'

import React from 'react'
import VideoPanelCardShell, { type VideoPanelCardShellProps } from './panel-card/VideoPanelCardShell'

export type { VideoPanelCardShellProps as VideoPanelCardProps } from './panel-card/VideoPanelCardShell'

const RENDER_LOG_FLUSH_MS = 1000
const renderCountByPanelKey = new Map<string, number>()
let renderLogTimer: ReturnType<typeof setTimeout> | null = null

function flushRenderLog() {
  renderLogTimer = null
  if (renderCountByPanelKey.size === 0) return

  const entries = Array.from(renderCountByPanelKey.entries())
  const totalRenders = entries.reduce((sum, [, count]) => sum + count, 0)
  const topCards = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, count]) => `${key}:${count}`)
    .join(', ')

  console.debug(`[VideoPanelCard] renders(last ${RENDER_LOG_FLUSH_MS}ms) total=${totalRenders}; top=${topCards}`)
  renderCountByPanelKey.clear()
}

function scheduleRenderLogFlush() {
  if (renderLogTimer) return
  renderLogTimer = setTimeout(flushRenderLog, RENDER_LOG_FLUSH_MS)
}

function VideoPanelCard(props: VideoPanelCardShellProps) {
  React.useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    const panelKey = `${props.panel.storyboardId}-${props.panel.panelIndex}`
    renderCountByPanelKey.set(panelKey, (renderCountByPanelKey.get(panelKey) || 0) + 1)
    scheduleRenderLogFlush()
  })

  return <VideoPanelCardShell {...props} />
}

function isSamePrimitiveArray(a: Array<string | number | boolean> = [], b: Array<string | number | boolean> = []) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function isSameGenerationOptions(
  a: VideoPanelCardShellProps['flGenerationOptions'],
  b: VideoPanelCardShellProps['flGenerationOptions'],
) {
  if (a === b) return true
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (a[key] !== b[key]) return false
  }
  return true
}

function isSameCapabilityFields(
  a: VideoPanelCardShellProps['flCapabilityFields'],
  b: VideoPanelCardShellProps['flCapabilityFields'],
) {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left.field !== right.field || left.label !== right.label || left.value !== right.value) return false
    if (!isSamePrimitiveArray(left.options, right.options)) return false
    if (!isSamePrimitiveArray(left.disabledOptions ?? [], right.disabledOptions ?? [])) return false
  }
  return true
}

function isSameMatchedVoiceLines(
  a: VideoPanelCardShellProps['matchedVoiceLines'],
  b: VideoPanelCardShellProps['matchedVoiceLines'],
) {
  if (a === b) return true
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i]
    const r = right[i]
    if (
      l.id !== r.id ||
      l.lineIndex !== r.lineIndex ||
      l.audioUrl !== r.audioUrl ||
      l.audioDuration !== r.audioDuration ||
      l.emotionStrength !== r.emotionStrength ||
      l.content !== r.content ||
      l.speaker !== r.speaker
    ) {
      return false
    }
  }
  return true
}

function areEqual(prev: VideoPanelCardShellProps, next: VideoPanelCardShellProps) {
  if (prev.panel !== next.panel) return false
  if (prev.nextPanel !== next.nextPanel) return false
  if (prev.prevPanel !== next.prevPanel) return false
  if (prev.runningVoiceLineIds !== next.runningVoiceLineIds) return false
  if (prev.userVideoModels !== next.userVideoModels) return false
  if (prev.capabilityOverrides !== next.capabilityOverrides) return false
  if (prev.flModelOptions !== next.flModelOptions) return false

  if (!isSameMatchedVoiceLines(prev.matchedVoiceLines, next.matchedVoiceLines)) return false
  if (!isSameGenerationOptions(prev.flGenerationOptions, next.flGenerationOptions)) return false
  if (!isSameCapabilityFields(prev.flCapabilityFields, next.flCapabilityFields)) return false
  if (!isSamePrimitiveArray(prev.flMissingCapabilityFields, next.flMissingCapabilityFields)) return false

  return (
    prev.panelIndex === next.panelIndex &&
    prev.defaultVideoModel === next.defaultVideoModel &&
    prev.videoRatio === next.videoRatio &&
    prev.projectId === next.projectId &&
    prev.episodeId === next.episodeId &&
    prev.showLipSyncVideo === next.showLipSyncVideo &&
    prev.isLinked === next.isLinked &&
    prev.isLastFrame === next.isLastFrame &&
    prev.nextPanelLinkedToNext === next.nextPanelLinkedToNext &&
    prev.hasNext === next.hasNext &&
    prev.flModel === next.flModel &&
    prev.flCustomPrompt === next.flCustomPrompt &&
    prev.defaultFlPrompt === next.defaultFlPrompt &&
    prev.localPrompt === next.localPrompt &&
    prev.localSourceText === next.localSourceText &&
    prev.isSavingPrompt === next.isSavingPrompt &&
    prev.isSavingSourceText === next.isSavingSourceText
  )
}

export default React.memo(VideoPanelCard, areEqual)
