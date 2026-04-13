'use client'

import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface VideoToolbarProps {
  totalPanels: number
  totalDurationSeconds: number
  runningCount: number
  videosWithUrl: number
  failedCount: number
  isAnyTaskRunning: boolean
  isDownloading: boolean
  isExportingSourceTexts?: boolean
  onGenerateAll: () => void
  onDownloadAll: () => void
  onExportAllSourceTexts: () => void
  onBack: () => void
  onEnterEditor?: () => void
  videosReady?: boolean
  durationMultiplier: string
  onDurationMultiplierChange: (value: string) => void
}

export default function VideoToolbar({
  totalPanels,
  totalDurationSeconds,
  runningCount,
  videosWithUrl,
  failedCount,
  isAnyTaskRunning,
  isDownloading,
  isExportingSourceTexts = false,
  onGenerateAll,
  onDownloadAll,
  onExportAllSourceTexts,
  onBack,
  onEnterEditor,
  videosReady = false,
  durationMultiplier,
  onDurationMultiplierChange,
}: VideoToolbarProps) {
  const t = useTranslations('video')
  const totalDurationLabel = `${Number.isInteger(totalDurationSeconds) ? totalDurationSeconds : totalDurationSeconds.toFixed(1)}${t('promptModal.duration')}`
  const videoTaskRunningState = isAnyTaskRunning
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'video',
      hasOutput: videosWithUrl > 0,
    })
    : null
  const videoDownloadState = isDownloading
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'video',
      hasOutput: videosWithUrl > 0,
    })
    : null

  return (
    <div className="glass-surface p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <span className="text-sm font-semibold text-[var(--glass-text-secondary)]">
            {t('toolbar.title')}
          </span>
          <span className="text-sm text-[var(--glass-text-tertiary)]">
            {t('toolbar.totalShots', { count: totalPanels })}
            <span className="ml-2">{t('toolbar.totalDuration', { duration: totalDurationLabel })}</span>
            {runningCount > 0 && (
              <span className="text-[var(--glass-tone-info-fg)] ml-2 animate-pulse">({t('toolbar.generatingShots', { count: runningCount })})</span>
            )}
            {videosWithUrl > 0 && (
              <span className="text-[var(--glass-tone-success-fg)] ml-2">({t('toolbar.completedShots', { count: videosWithUrl })})</span>
            )}
            {failedCount > 0 && (
              <span className="text-[var(--glass-tone-danger-fg)] ml-2">({t('toolbar.failedShots', { count: failedCount })})</span>
            )}
          </span>
          <label className="flex items-center gap-2 text-sm text-[var(--glass-text-secondary)]">
            <span>{t('toolbar.durationMultiplier')}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.1"
              max="5"
              step="0.1"
              value={durationMultiplier}
              onChange={(event) => onDurationMultiplierChange(event.target.value)}
              className="w-20 rounded-lg border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-2 py-1 text-sm text-[var(--glass-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--glass-tone-info-fg)]"
            />
            <span className="text-xs text-[var(--glass-text-tertiary)]">{t('toolbar.durationMultiplierHint')}</span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onGenerateAll}
            disabled={isAnyTaskRunning}
            className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnyTaskRunning ? (
              <TaskStatusInline state={videoTaskRunningState} className="text-white [&>span]:text-white [&_svg]:text-white" />
            ) : (
              <>
                <AppIcon name="plus" className="w-4 h-4" />
                <span>{t('toolbar.generateAll')}</span>
              </>
            )}
          </button>
          <button
            onClick={onDownloadAll}
            disabled={videosWithUrl === 0 || isDownloading}
            className="glass-btn-base glass-btn-tone-info flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={videosWithUrl === 0 ? t('toolbar.noVideos') : t('toolbar.downloadCount', { count: videosWithUrl })}
          >
            {isDownloading ? (
              <TaskStatusInline state={videoDownloadState} className="text-white [&>span]:text-white [&_svg]:text-white" />
            ) : (
              <>
                <AppIcon name="image" className="w-4 h-4" />
                <span>{t('toolbar.downloadAll')}</span>
              </>
            )}
          </button>
          <button
            onClick={onExportAllSourceTexts}
            disabled={totalPanels === 0 || isExportingSourceTexts}
            className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('toolbar.exportAllSourceTexts')}
          >
            <AppIcon name="copy" className="w-4 h-4" />
            <span>{isExportingSourceTexts ? t('toolbar.exportingSourceTexts') : t('toolbar.exportAllSourceTexts')}</span>
          </button>
          {onEnterEditor && (
            <button
              onClick={onEnterEditor}
              disabled={!videosReady}
              className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] disabled:opacity-50 disabled:cursor-not-allowed"
              title={videosReady ? t('toolbar.enterEditor') : t('panelCard.needVideo')}
            >
              <AppIcon name="wandOff" className="w-4 h-4" />
              <span>{t('toolbar.enterEdit')}</span>
            </button>
          )}
          <button
            onClick={onBack}
            className="glass-btn-base glass-btn-secondary flex items-center gap-2 px-4 py-2 text-sm font-medium border border-[var(--glass-stroke-base)] hover:text-[var(--glass-tone-info-fg)]"
          >
            <AppIcon name="chevronLeft" className="w-4 h-4" />
            <span>{t('toolbar.back')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
