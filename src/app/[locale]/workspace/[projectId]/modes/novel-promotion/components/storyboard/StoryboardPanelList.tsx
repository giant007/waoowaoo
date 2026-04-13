'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Character, Location, NovelPromotionPanel } from '@/types/project'
import { StoryboardPanel } from './hooks/useStoryboardState'
import { PanelEditData } from '../PanelEditForm'
import { ASPECT_RATIO_CONFIGS } from '@/lib/constants'
import PanelCard from './PanelCard'
import type { PanelSaveState } from './hooks/usePanelCrudActions'
import './StoryboardPanelList.css'

interface StoryboardPanelListProps {
  projectId: string
  storyboardId: string
  textPanels: StoryboardPanel[]
  storyboardStartIndex: number
  videoRatio: string
  characters: Character[]
  locations: Location[]
  isSubmittingStoryboardTextTask: boolean
  savingPanels: Set<string>
  deletingPanelIds: Set<string>
  saveStateByPanel: Record<string, PanelSaveState>
  hasUnsavedByPanel: Set<string>
  modifyingPanels: Set<string>
  panelTaskErrorMap: Map<string, { taskId: string; message: string }>
  isPanelTaskRunning: (panel: StoryboardPanel) => boolean
  getPanelEditData: (panel: StoryboardPanel) => PanelEditData
  getPanelCandidates: (panel: NovelPromotionPanel) => { candidates: string[]; selectedIndex: number } | null
  onPanelUpdate: (panelId: string, panel: StoryboardPanel, updates: Partial<PanelEditData>) => void
  onPanelDelete: (panelId: string) => void
  onOpenCharacterPicker: (panelId: string) => void
  onOpenLocationPicker: (panelId: string) => void
  onRemoveCharacter: (panel: StoryboardPanel, index: number) => void
  onRemoveLocation: (panel: StoryboardPanel) => void
  onRetryPanelSave: (panelId: string) => void
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean) => void
  onOpenEditModal: (panelIndex: number) => void
  onOpenAIDataModal: (panelIndex: number) => void
  onSelectPanelCandidateIndex: (panelId: string, index: number) => void
  onConfirmPanelCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelPanelCandidate: (panelId: string) => void
  onClearPanelTaskError: (panelId: string) => void
  onPreviewImage: (url: string) => void
  onInsertAfter: (panelIndex: number) => void
  onVariant: (panelIndex: number) => void
  isInsertDisabled: (panelId: string) => boolean
}

export default function StoryboardPanelList({
  projectId,
  storyboardId,
  textPanels,
  storyboardStartIndex,
  videoRatio,
  characters,
  locations,
  isSubmittingStoryboardTextTask,
  savingPanels,
  deletingPanelIds,
  saveStateByPanel,
  hasUnsavedByPanel,
  modifyingPanels,
  panelTaskErrorMap,
  isPanelTaskRunning,
  getPanelEditData,
  getPanelCandidates,
  onPanelUpdate,
  onPanelDelete,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRemoveCharacter,
  onRemoveLocation,
  onRetryPanelSave,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onSelectPanelCandidateIndex,
  onConfirmPanelCandidate,
  onCancelPanelCandidate,
  onClearPanelTaskError,
  onPreviewImage,
  onInsertAfter,
  onVariant,
  isInsertDisabled,
}: StoryboardPanelListProps) {
  const displayImages = useMemo(() => textPanels.map((panel) => panel.imageUrl || null), [textPanels])
  const isVertical = ASPECT_RATIO_CONFIGS[videoRatio]?.isVertical ?? false
  const columnCount = isVertical ? 5 : 3
  const gapPx = 16

  const containerRef = useRef<HTMLDivElement>(null)
  const [itemHeight, setItemHeight] = useState(520)
  const [containerTop, setContainerTop] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(800)
  const [measureNode, setMeasureNode] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    setItemHeight(520)
  }, [storyboardId, textPanels.length, videoRatio])

  useEffect(() => {
    const update = () => {
      const top = containerRef.current?.getBoundingClientRect().top ?? 0
      setContainerTop(top + window.scrollY)
      setScrollY(window.scrollY)
      setViewportHeight(window.innerHeight || 800)
    }
    update()
    const onScroll = () => {
      requestAnimationFrame(update)
    }
    const onResize = () => {
      update()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  useEffect(() => {
    if (!measureNode || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const nextHeight = Math.max(200, Math.round(entry.contentRect.height))
      setItemHeight((previous) => (nextHeight > previous ? nextHeight : previous))
    })
    observer.observe(measureNode)
    return () => observer.disconnect()
  }, [measureNode])

  const totalCount = textPanels.length
  const rowHeight = itemHeight + gapPx
  const totalRows = Math.ceil(totalCount / columnCount)
  const totalHeight = totalRows > 0 ? (totalRows * itemHeight) + (Math.max(0, totalRows - 1) * gapPx) : 0
  const overscanRows = 2
  const startRow = Math.max(0, Math.floor((scrollY - containerTop - overscanRows * rowHeight) / rowHeight))
  const endRow = Math.min(
    totalRows - 1,
    Math.floor((scrollY - containerTop + viewportHeight + overscanRows * rowHeight) / rowHeight),
  )
  const startIndex = Math.max(0, startRow * columnCount)
  const endIndex = Math.min(totalCount, (endRow + 1) * columnCount)
  const visiblePanels = textPanels.slice(startIndex, endIndex)
  const visibleOffset = startRow * rowHeight

  const bindMeasureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    setMeasureNode(node)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative ${isSubmittingStoryboardTextTask ? 'opacity-50 pointer-events-none' : ''}`}
      style={{ minHeight: totalHeight }}
    >
      <div style={{ height: totalHeight }} />
      <div
        className={`absolute left-0 right-0 top-0 grid gap-4 ${isVertical ? 'grid-cols-5' : 'grid-cols-3'}`}
        style={{ transform: `translateY(${visibleOffset}px)` }}
      >
        {visiblePanels.map((panel, localIndex) => {
          const index = startIndex + localIndex
          const imageUrl = displayImages[index]
          const globalPanelNumber = storyboardStartIndex + index + 1
          const isPanelModifying =
            modifyingPanels.has(panel.id) ||
            Boolean(
              (panel as StoryboardPanel & { imageTaskRunning?: boolean; imageTaskIntent?: string }).imageTaskRunning &&
              (panel as StoryboardPanel & { imageTaskIntent?: string }).imageTaskIntent === 'modify',
            )
          const isPanelDeleting = deletingPanelIds.has(panel.id)
          const panelSaveState = saveStateByPanel[panel.id]
          const isPanelSaving = savingPanels.has(panel.id) || panelSaveState?.status === 'saving'
          const hasUnsavedChanges = hasUnsavedByPanel.has(panel.id) || panelSaveState?.status === 'error'
          const panelSaveError = panelSaveState?.errorMessage || null
          const panelTaskRunning = isPanelTaskRunning(panel)
          const taskError = panelTaskErrorMap.get(panel.id)
          const panelFailedError = taskError?.message || null
          const panelData = getPanelEditData(panel)
          const panelCandidateData = getPanelCandidates(panel as unknown as NovelPromotionPanel)

          return (
            <div
              key={panel.id || index}
              ref={localIndex === 0 ? bindMeasureRef : undefined}
              className="relative group/panel h-full storyboard-panel-virtual"
              style={{ zIndex: totalCount - index }}
            >
              <PanelCard
                panel={panel}
                panelData={panelData}
                imageUrl={imageUrl}
                globalPanelNumber={globalPanelNumber}
                projectId={projectId}
                storyboardId={storyboardId}
                videoRatio={videoRatio}
                characters={characters}
                locations={locations}
                isSaving={isPanelSaving}
                hasUnsavedChanges={hasUnsavedChanges}
                saveErrorMessage={panelSaveError}
                isDeleting={isPanelDeleting}
                isModifying={isPanelModifying}
                isSubmittingPanelImageTask={panelTaskRunning}
                failedError={panelFailedError}
                candidateData={panelCandidateData}
                onUpdate={(updates) => onPanelUpdate(panel.id, panel, updates)}
                onDelete={() => onPanelDelete(panel.id)}
                onOpenCharacterPicker={() => onOpenCharacterPicker(panel.id)}
                onOpenLocationPicker={() => onOpenLocationPicker(panel.id)}
                onRetrySave={() => onRetryPanelSave(panel.id)}
                onRemoveCharacter={(characterIndex) => onRemoveCharacter(panel, characterIndex)}
                onRemoveLocation={() => onRemoveLocation(panel)}
                onRegeneratePanelImage={onRegeneratePanelImage}
                onOpenEditModal={() => onOpenEditModal(index)}
                onOpenAIDataModal={() => onOpenAIDataModal(index)}
                onSelectCandidateIndex={onSelectPanelCandidateIndex}
                onConfirmCandidate={onConfirmPanelCandidate}
                onCancelCandidate={onCancelPanelCandidate}
                onClearError={() => onClearPanelTaskError(panel.id)}
                onPreviewImage={onPreviewImage}
                onInsertAfter={() => onInsertAfter(index)}
                onVariant={() => onVariant(index)}
                isInsertDisabled={isInsertDisabled(panel.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
