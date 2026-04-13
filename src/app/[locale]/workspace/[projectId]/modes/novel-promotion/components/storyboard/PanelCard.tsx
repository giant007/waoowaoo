'use client'

import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import PanelEditForm, { PanelEditData } from '../PanelEditForm'
import ImageSection from './ImageSection'
import PanelActionButtons from './PanelActionButtons'
import { StoryboardPanel } from './hooks/useStoryboardState'
import { GlassModalShell, GlassSurface } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'
import { useWorkspaceStageRuntime } from '../../WorkspaceStageRuntimeContext'
import {
  buildStoryboardImagePromptPayload,
  buildStoryboardVariantPromptPayload,
  type PromptPayload,
} from '@/lib/storyboard/prompt-builders'
import type { Character, Location } from '@/types/project'

interface PanelCandidateData {
  candidates: string[]
  selectedIndex: number
}

interface PanelCardProps {
  panel: StoryboardPanel
  panelData: PanelEditData
  imageUrl: string | null
  globalPanelNumber: number
  projectId: string
  storyboardId: string
  videoRatio: string
  characters: Character[]
  locations: Location[]
  isSaving: boolean
  hasUnsavedChanges?: boolean
  saveErrorMessage?: string | null
  isDeleting: boolean
  isModifying: boolean
  isSubmittingPanelImageTask: boolean
  failedError: string | null
  candidateData: PanelCandidateData | null
  previousImageUrl?: string | null  // 支持撤回
  onUpdate: (updates: Partial<PanelEditData>) => void
  onDelete: () => void
  onOpenCharacterPicker: () => void
  onOpenLocationPicker: () => void
  onRetrySave?: () => void
  onRemoveCharacter: (index: number) => void
  onRemoveLocation: () => void
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean) => void
  onOpenEditModal: () => void
  onOpenAIDataModal: () => void
  onSelectCandidateIndex: (panelId: string, index: number) => void
  onConfirmCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelCandidate: (panelId: string) => void
  onClearError: () => void
  onUndo?: (panelId: string) => void  // 撤回到上一版本
  onPreviewImage?: (url: string) => void  // 放大预览图片
  onInsertAfter?: () => void  // 在此镜头后插入
  onVariant?: () => void  // 生成镜头变体
  isInsertDisabled?: boolean  // 插入按钮是否禁用
}

export default function PanelCard({
  panel,
  panelData,
  imageUrl,
  globalPanelNumber,
  projectId,
  storyboardId,
  videoRatio,
  characters,
  locations,
  isSaving,
  hasUnsavedChanges = false,
  saveErrorMessage = null,
  isDeleting,
  isModifying,
  isSubmittingPanelImageTask,
  failedError,
  candidateData,
  previousImageUrl,
  onUpdate,
  onDelete,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRetrySave,
  onRemoveCharacter,
  onRemoveLocation,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onSelectCandidateIndex,
  onConfirmCandidate,
  onCancelCandidate,
  onClearError,
  onUndo,
  onPreviewImage,
  onInsertAfter,
  onVariant,
  isInsertDisabled
}: PanelCardProps) {
  const t = useTranslations('storyboard')
  const locale = useLocale()
  const { artStyle } = useWorkspaceStageRuntime()

  const imagePromptPayload = useMemo(() => {
    return buildStoryboardImagePromptPayload({
      locale: locale === 'en' ? 'en' : 'zh',
      aspectRatio: videoRatio,
      artStyle,
      panel: {
        id: panel.id,
        shotType: panelData.shotType,
        cameraMove: panelData.cameraMove,
        description: panelData.description,
        videoPrompt: panelData.videoPrompt,
        location: panelData.location,
        characters: panelData.characters,
        srtSegment: panel.source_text || null,
        photographyRules: panelData.photographyRules ?? null,
        actingNotes: panelData.actingNotes ?? null,
      },
      characters,
      locations,
    })
  }, [
    artStyle,
    characters,
    locations,
    locale,
    panel.id,
    panel.source_text,
    panelData.actingNotes,
    panelData.cameraMove,
    panelData.characters,
    panelData.description,
    panelData.location,
    panelData.photographyRules,
    panelData.shotType,
    panelData.videoPrompt,
    videoRatio,
  ])

  const videoPromptPayload = useMemo(() => {
    return buildStoryboardVariantPromptPayload({
      locale: locale === 'en' ? 'en' : 'zh',
      aspectRatio: videoRatio,
      artStyle,
      panel: {
        id: panel.id,
        shotType: panelData.shotType,
        cameraMove: panelData.cameraMove,
        description: panelData.description,
        videoPrompt: panelData.videoPrompt,
        location: panelData.location,
        characters: panelData.characters,
        srtSegment: panel.source_text || null,
      },
      characters,
    })
  }, [
    artStyle,
    characters,
    locale,
    panel.id,
    panel.source_text,
    panelData.cameraMove,
    panelData.characters,
    panelData.description,
    panelData.location,
    panelData.shotType,
    panelData.videoPrompt,
    videoRatio,
  ])

  const [imagePrompt, setImagePrompt] = useState('')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [imagePromptError, setImagePromptError] = useState<string | null>(null)
  const [videoPromptError, setVideoPromptError] = useState<string | null>(null)
  const [isCopyingImage, setIsCopyingImage] = useState(false)
  const [isCopyingVideo, setIsCopyingVideo] = useState(false)
  const [imageCopied, setImageCopied] = useState(false)
  const [videoCopied, setVideoCopied] = useState(false)
  const [showImagePromptModal, setShowImagePromptModal] = useState(false)
  const [showVideoPromptModal, setShowVideoPromptModal] = useState(false)
  const [isResolvingImagePrompt, setIsResolvingImagePrompt] = useState(false)
  const [isResolvingVideoPrompt, setIsResolvingVideoPrompt] = useState(false)
  const promptEmptyErrorText = locale === 'en' ? 'Prompt is empty' : '提示词为空'

  const copyText = async (text: string, onDone?: () => void) => {
    if (!text) return
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
    } finally {
      onDone?.()
    }
  }

  const promptCacheRef = useRef(new Map<string, string>())
  const promptInFlightRef = useRef(new Map<string, Promise<string>>())

  const resolvePrompt = async (payload: PromptPayload, cacheKey: string, signal?: AbortSignal) => {
    const cached = promptCacheRef.current.get(cacheKey)
    if (cached !== undefined) return cached

    const inFlight = promptInFlightRef.current.get(cacheKey)
    if (inFlight) return inFlight

    const request = (async () => {
      const response = await fetch('/api/prompts/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}))
        throw new Error(errorBody?.error || 'Prompt build failed')
      }
      const data = await response.json() as { prompt?: string }
      const prompt = data.prompt || ''
      if (prompt) {
        promptCacheRef.current.set(cacheKey, prompt)
      }
      return prompt
    })()

    promptInFlightRef.current.set(cacheKey, request)
    try {
      return await request
    } finally {
      promptInFlightRef.current.delete(cacheKey)
    }
  }

  const ensurePromptResolved = async (
    payload: PromptPayload,
    setPrompt: (value: string) => void,
    setError: (value: string | null) => void,
    setLoading: (value: boolean) => void,
  ) => {
    const cacheKey = JSON.stringify(payload)
    const cached = promptCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      setPrompt(cached)
      return cached
    }

    setLoading(true)
    setError(null)
    try {
      const prompt = await resolvePrompt(payload, cacheKey)
      setPrompt(prompt)
      return prompt
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return ''
      }
      const message = error instanceof Error ? error.message : 'Prompt build failed'
      setError(message)
      return ''
    } finally {
      setLoading(false)
    }
  }

  const handleOpenImagePromptModal = () => {
    setShowImagePromptModal(true)
    void ensurePromptResolved(imagePromptPayload, setImagePrompt, setImagePromptError, setIsResolvingImagePrompt)
  }

  const handleOpenVideoPromptModal = () => {
    setShowVideoPromptModal(true)
    void ensurePromptResolved(videoPromptPayload, setVideoPrompt, setVideoPromptError, setIsResolvingVideoPrompt)
  }

  const handleCopyImagePrompt = async () => {
    if (isCopyingImage) return
    setIsCopyingImage(true)
    try {
      const prompt = imagePrompt.trim()
        ? imagePrompt
        : await ensurePromptResolved(imagePromptPayload, setImagePrompt, setImagePromptError, setIsResolvingImagePrompt)
      if (!prompt.trim()) {
        setImagePromptError(promptEmptyErrorText)
        return
      }
      await copyText(prompt, () => {
        setImageCopied(true)
        setTimeout(() => setImageCopied(false), 1500)
      })
    } finally {
      setIsCopyingImage(false)
    }
  }

  const handleCopyVideoPrompt = async () => {
    if (isCopyingVideo) return
    setIsCopyingVideo(true)
    try {
      const prompt = videoPrompt.trim()
        ? videoPrompt
        : await ensurePromptResolved(videoPromptPayload, setVideoPrompt, setVideoPromptError, setIsResolvingVideoPrompt)
      if (!prompt.trim()) {
        setVideoPromptError(promptEmptyErrorText)
        return
      }
      await copyText(prompt, () => {
        setVideoCopied(true)
        setTimeout(() => setVideoCopied(false), 1500)
      })
    } finally {
      setIsCopyingVideo(false)
    }
  }

  useEffect(() => {
    let isActive = true
    const cacheKey = JSON.stringify(imagePromptPayload)
    const cached = promptCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      setImagePrompt(cached)
      return () => {
        isActive = false
      }
    }

    setImagePromptError(null)
    setIsResolvingImagePrompt(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      resolvePrompt(imagePromptPayload, cacheKey, controller.signal)
        .then((prompt) => {
          if (isActive) {
            setImagePrompt(prompt)
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          if (isActive) {
            const message = error instanceof Error ? error.message : 'Prompt build failed'
            setImagePromptError(message)
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.warn('[PanelCard] image prompt resolve failed', { message, payload: imagePromptPayload })
            }
          }
        })
        .finally(() => {
          if (isActive) {
            setIsResolvingImagePrompt(false)
          }
        })
    }, 150)

    return () => {
      isActive = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [imagePromptPayload])

  useEffect(() => {
    let isActive = true
    const cacheKey = JSON.stringify(videoPromptPayload)
    const cached = promptCacheRef.current.get(cacheKey)
    if (cached !== undefined) {
      setVideoPrompt(cached)
      return () => {
        isActive = false
      }
    }

    setVideoPromptError(null)
    setIsResolvingVideoPrompt(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      resolvePrompt(videoPromptPayload, cacheKey, controller.signal)
        .then((prompt) => {
          if (isActive) {
            setVideoPrompt(prompt)
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          if (isActive) {
            const message = error instanceof Error ? error.message : 'Prompt build failed'
            setVideoPromptError(message)
            if (process.env.NODE_ENV !== 'production') {
              // eslint-disable-next-line no-console
              console.warn('[PanelCard] video prompt resolve failed', { message, payload: videoPromptPayload })
            }
          }
        })
        .finally(() => {
          if (isActive) {
            setIsResolvingVideoPrompt(false)
          }
        })
    }, 150)

    return () => {
      isActive = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [videoPromptPayload])
  return (
    <GlassSurface
      variant="elevated"
      padded={false}
      className="relative h-full overflow-visible transition-all hover:shadow-[var(--glass-shadow-md)] group/card"
      data-storyboard-id={storyboardId}
    >
      {/* 删除按钮 - 右上角外部 */}
      {!isModifying && !isDeleting && (
        <button
          onClick={onDelete}
          className="absolute -top-2 -right-2 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity bg-[var(--glass-tone-danger-fg)] hover:bg-[var(--glass-tone-danger-fg)] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs shadow-md"
          title={t('panelActions.deleteShot')}
        >
          <AppIcon name="closeMd" className="h-3 w-3" />
        </button>
      )}

      {/* 镜头图片区域 - 包含插入按钮 */}
      <div className="relative">
        <ImageSection
          panelId={panel.id}
          imageUrl={imageUrl}
          globalPanelNumber={globalPanelNumber}
          projectId={projectId}
          shotType={panel.shot_type}
          videoRatio={videoRatio}
          isDeleting={isDeleting}
          isModifying={isModifying}
          isSubmittingPanelImageTask={isSubmittingPanelImageTask}
          failedError={failedError}
          candidateData={candidateData}
          previousImageUrl={previousImageUrl}
          onRegeneratePanelImage={onRegeneratePanelImage}
          onOpenEditModal={onOpenEditModal}
          onOpenAIDataModal={onOpenAIDataModal}
          onSelectCandidateIndex={onSelectCandidateIndex}
          onConfirmCandidate={onConfirmCandidate}
          onCancelCandidate={onCancelCandidate}
          onClearError={onClearError}
          onUndo={onUndo}
          onPreviewImage={onPreviewImage}
        />
        {/* 插入分镜/镜头变体按钮 - 在图片区域右侧垂直居中 */}
        {(onInsertAfter || onVariant) && (
          <div className="absolute -right-[22px] top-1/2 -translate-y-1/2 z-50">
            <PanelActionButtons
              onInsertPanel={onInsertAfter || (() => { })}
              onVariant={onVariant || (() => { })}
              disabled={isInsertDisabled}
              hasImage={!!imageUrl}
            />
          </div>
        )}
      </div>

      {/* 分镜信息编辑区 */}

      <div className="border-t border-[var(--glass-stroke-base)] px-3 py-2 bg-[var(--glass-bg-surface)]">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleOpenImagePromptModal}
            className="text-[10px] font-semibold text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-primary)] transition-colors"
          >
            {t('imagePrompt.title')}
          </button>
          <button
            type="button"
            onClick={() => { void handleCopyImagePrompt() }}
            disabled={isCopyingImage}
            className="glass-btn-base glass-btn-secondary px-2 py-0.5 text-[10px] rounded disabled:opacity-50"
          >
            {imageCopied ? t('common.copied') : t('imagePrompt.copy')}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={handleOpenVideoPromptModal}
            className="text-[10px] font-semibold text-[var(--glass-text-tertiary)] hover:text-[var(--glass-text-primary)] transition-colors"
          >
            {t('videoPrompt.title')}
          </button>
          <button
            type="button"
            onClick={() => { void handleCopyVideoPrompt() }}
            disabled={isCopyingVideo}
            className="glass-btn-base glass-btn-secondary px-2 py-0.5 text-[10px] rounded disabled:opacity-50"
          >
            {videoCopied ? t('common.copied') : t('videoPrompt.copy')}
          </button>
        </div>
      </div>

      <div className="p-3">
        <PanelEditForm
          panelData={panelData}
          isSaving={isSaving}
          saveStatus={hasUnsavedChanges ? 'error' : (isSaving ? 'saving' : 'idle')}
          saveErrorMessage={saveErrorMessage}
          onRetrySave={onRetrySave}
          onUpdate={onUpdate}
          onOpenCharacterPicker={onOpenCharacterPicker}
          onOpenLocationPicker={onOpenLocationPicker}
          onRemoveCharacter={onRemoveCharacter}
          onRemoveLocation={onRemoveLocation}
        />
      </div>

      <GlassModalShell
        open={showImagePromptModal}
        onClose={() => setShowImagePromptModal(false)}
        title={t('imagePrompt.title')}
        size="lg"
        footer={(
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowImagePromptModal(false)}
              className="glass-btn-base glass-btn-secondary px-3 py-1 text-xs rounded"
            >
              {t('variant.close')}
            </button>
          </div>
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-[var(--glass-text-secondary)]">
            {isResolvingImagePrompt ? t('common.loading') : imagePrompt ? t('common.preview') : t('common.none')}
          </div>
          <button
            type="button"
            onClick={() => { void handleCopyImagePrompt() }}
            disabled={isCopyingImage}
            className="glass-btn-base glass-btn-secondary px-3 py-1 text-xs rounded disabled:opacity-50"
          >
            {imageCopied ? t('common.copied') : t('imagePrompt.copy')}
          </button>
        </div>
        <div className="text-sm text-[var(--glass-text-secondary)] whitespace-pre-wrap max-h-[50vh] overflow-auto">
          {isResolvingImagePrompt ? t('common.loading') : imagePrompt || t('common.none')}
        </div>
        {imagePromptError && (
          <div className="mt-3 rounded-md border border-[var(--glass-stroke-danger)] bg-[var(--glass-danger-ring)] p-2 text-xs text-[var(--glass-tone-danger-fg)]">
            {imagePromptError}
          </div>
        )}
      </GlassModalShell>

      <GlassModalShell
        open={showVideoPromptModal}
        onClose={() => setShowVideoPromptModal(false)}
        title={t('videoPrompt.title')}
        size="lg"
        footer={(
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowVideoPromptModal(false)}
              className="glass-btn-base glass-btn-secondary px-3 py-1 text-xs rounded"
            >
              {t('variant.close')}
            </button>
          </div>
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs text-[var(--glass-text-secondary)]">
            {isResolvingVideoPrompt ? t('common.loading') : videoPrompt ? t('common.preview') : t('common.none')}
          </div>
          <button
            type="button"
            onClick={() => { void handleCopyVideoPrompt() }}
            disabled={isCopyingVideo}
            className="glass-btn-base glass-btn-secondary px-3 py-1 text-xs rounded disabled:opacity-50"
          >
            {videoCopied ? t('common.copied') : t('videoPrompt.copy')}
          </button>
        </div>
        <div className="text-sm text-[var(--glass-text-secondary)] whitespace-pre-wrap max-h-[50vh] overflow-auto">
          {isResolvingVideoPrompt ? t('common.loading') : videoPrompt || t('common.none')}
        </div>
        {videoPromptError && (
          <div className="mt-3 rounded-md border border-[var(--glass-stroke-danger)] bg-[var(--glass-danger-ring)] p-2 text-xs text-[var(--glass-tone-danger-fg)]">
            {videoPromptError}
          </div>
        )}
      </GlassModalShell>
    </GlassSurface>
  )
}
