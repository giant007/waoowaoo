import { Worker, type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { queueRedis } from '@/lib/redis'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { getUserWorkflowConcurrencyConfig } from '@/lib/config-service'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { withUserConcurrencyGate } from './user-concurrency-gate'
import {
  assertTaskActive,
  getProjectModels,
  resolveLipSyncVideoSource,
  resolveVideoSourceFromGeneration,
  toSignedUrlIfCos,
  uploadVideoSourceToCos,
} from './utils'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { getProviderConfig } from '@/lib/api-config'
import { submitTask } from '@/lib/task/submitter'
import { hasPanelLipSyncOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { composeModelKey } from '@/lib/model-config-contract'
import type { Locale } from '@/i18n/routing'

type AnyObj = Record<string, unknown>
type VideoOptionValue = string | number | boolean
type VideoOptionMap = Record<string, VideoOptionValue>
type VideoGenerationMode = 'normal' | 'firstlastframe'
type PanelRecord = NonNullable<Awaited<ReturnType<typeof prisma.novelPromotionPanel.findUnique>>>
const DEFAULT_LIPSYNC_MODEL_KEY = composeModelKey('fal', 'fal-ai/kling-video/lipsync/audio-to-video')

function toDurationMs(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value > 1000 ? Math.round(value) : Math.round(value * 1000)
}

function extractGenerationOptions(payload: AnyObj): VideoOptionMap {
  const fromEnvelope = payload.generationOptions
  if (!fromEnvelope || typeof fromEnvelope !== 'object' || Array.isArray(fromEnvelope)) {
    return {}
  }

  const next: VideoOptionMap = {}
  for (const [key, value] of Object.entries(fromEnvelope as Record<string, unknown>)) {
    if (key === 'aspectRatio') continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = value
    }
  }
  return next
}

async function fetchPanelByStoryboardIndex(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionPanel.findFirst({
    where: {
      storyboardId,
      panelIndex,
    },
  })
}

function buildFirstLastFramePrompt(
  firstPrompt: string | null | undefined,
  lastPrompt: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const first = typeof firstPrompt === 'string' ? firstPrompt.trim() : ''
  const last = typeof lastPrompt === 'string' ? lastPrompt.trim() : ''
  const fallbackText = typeof fallback === 'string' ? fallback.trim() : ''

  if (first && last) {
    return `${first}\nThen transition to: ${last}`
  }
  if (first) return first
  if (last) return last
  return fallbackText || null
}

async function fetchMatchedVoiceLineWithAudio(storyboardId: string, panelIndex: number) {
  return await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      matchedStoryboardId: storyboardId,
      matchedPanelIndex: panelIndex,
      audioUrl: {
        not: null,
      },
    },
    orderBy: [
      { lineIndex: 'asc' },
      { createdAt: 'asc' },
    ],
  })
}

async function resolveLipSyncModel(userId: string): Promise<string> {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { lipSyncModel: true },
  })
  const preferredLipSyncModel =
    typeof preference?.lipSyncModel === 'string' ? preference.lipSyncModel.trim() : ''
  return parseModelKeyStrict(preferredLipSyncModel) ? preferredLipSyncModel : DEFAULT_LIPSYNC_MODEL_KEY
}

async function enqueueAutoLipSyncForGeneratedVideo(params: {
  job: Job<TaskJobData>
  panel: PanelRecord
  lastPanel: PanelRecord | null
}) {
  const { job, panel, lastPanel } = params
  if (!lastPanel) return null

  const voiceLine = await fetchMatchedVoiceLineWithAudio(lastPanel.storyboardId, lastPanel.panelIndex)
  if (!voiceLine?.audioUrl) return null

  const lipSyncModel = await resolveLipSyncModel(job.data.userId)

  try {
    return await submitTask({
      userId: job.data.userId,
      locale: job.data.locale as Locale,
      requestId: job.data.trace?.requestId || null,
      projectId: job.data.projectId,
      episodeId: job.data.episodeId || null,
      type: TASK_TYPE.LIP_SYNC,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
      payload: withTaskUiPayload({
        storyboardId: panel.storyboardId,
        panelIndex: panel.panelIndex,
        voiceLineId: voiceLine.id,
        lipSyncModel,
        autoTriggeredByFirstLastFrame: true,
        autoLipSyncSourceStoryboardId: lastPanel.storyboardId,
        autoLipSyncSourcePanelIndex: lastPanel.panelIndex,
      }, {
        hasOutputAtStart: await hasPanelLipSyncOutput(panel.id),
      }),
      dedupeKey: `lip_sync:${panel.id}:${voiceLine.id}`,
    })
  } catch {
    return null
  }
}

async function getPanelForVideoTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj

  // 优先使用 targetType=NovelPromotionPanel 直接定位
  if (job.data.targetType === 'NovelPromotionPanel') {
    const panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
    if (!panel) throw new Error('Panel not found')
    return panel
  }

  // 兜底：通过 storyboardId + panelIndex 定位
  const storyboardId = payload.storyboardId
  const panelIndex = payload.panelIndex
  if (typeof storyboardId !== 'string' || !storyboardId || panelIndex === undefined || panelIndex === null) {
    throw new Error('Missing storyboardId/panelIndex for video task')
  }

  const panel = await fetchPanelByStoryboardIndex(storyboardId, Number(panelIndex))
  if (!panel) throw new Error('Panel not found by storyboardId/panelIndex')
  return panel
}

async function generateVideoForPanel(
  job: Job<TaskJobData>,
  panel: PanelRecord,
  payload: AnyObj,
  modelId: string,
  projectVideoRatio: string | null | undefined,
  generationOptions: VideoOptionMap,
): Promise<{ cosKey: string; generationMode: VideoGenerationMode }> {
  if (!panel.imageUrl) {
    throw new Error(`Panel ${panel.id} has no imageUrl`)
  }

  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  const firstLastCustomPrompt = typeof firstLastFramePayload?.customPrompt === 'string' ? firstLastFramePayload.customPrompt : null
  const persistedFirstLastPrompt = firstLastFramePayload ? panel.firstLastFramePrompt : null
  const customPrompt = typeof payload.customPrompt === 'string' ? payload.customPrompt : null
  let lastPanel: PanelRecord | null = null

  if (
    firstLastFramePayload &&
    typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
    firstLastFramePayload.lastFrameStoryboardId &&
    firstLastFramePayload.lastFramePanelIndex !== undefined
  ) {
    lastPanel = await fetchPanelByStoryboardIndex(
      firstLastFramePayload.lastFrameStoryboardId,
      Number(firstLastFramePayload.lastFramePanelIndex),
    )
  }

  const prompt = firstLastCustomPrompt
    || persistedFirstLastPrompt
    || (firstLastFramePayload
      ? buildFirstLastFramePrompt(panel.videoPrompt, lastPanel?.videoPrompt, customPrompt || panel.description)
      : (customPrompt || panel.videoPrompt || panel.description))
  if (!prompt) {
    throw new Error(`Panel ${panel.id} has no video prompt`)
  }

  const sourceImageUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
  if (!sourceImageUrl) {
    throw new Error(`Panel ${panel.id} image url invalid`)
  }
  const sourceImageBase64 = await normalizeToBase64ForGeneration(sourceImageUrl)

  let lastFrameImageBase64: string | undefined
  const generationMode: VideoGenerationMode = firstLastFramePayload ? 'firstlastframe' : 'normal'
  const requestedGenerateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  let model = modelId

  if (firstLastFramePayload) {
    model =
      typeof firstLastFramePayload.flModel === 'string' && firstLastFramePayload.flModel
        ? firstLastFramePayload.flModel
        : modelId
    const firstLastFrameCapabilities = resolveBuiltinCapabilitiesByModelKey('video', model)
    if (firstLastFrameCapabilities?.video?.firstlastframe !== true) {
      throw new Error(`VIDEO_FIRSTLASTFRAME_MODEL_UNSUPPORTED: ${model}`)
    }
    if (lastPanel?.imageUrl) {
      const lastFrameUrl = toSignedUrlIfCos(lastPanel.imageUrl, 3600)
      if (lastFrameUrl) {
        lastFrameImageBase64 = await normalizeToBase64ForGeneration(lastFrameUrl)
      }
    }
  }

  const generatedVideo = await resolveVideoSourceFromGeneration(job, {
    userId: job.data.userId,
    modelId: model,
    imageUrl: sourceImageBase64,
    options: {
      prompt,
      ...(projectVideoRatio ? { aspectRatio: projectVideoRatio } : {}),
      ...generationOptions,
      generationMode,
      ...(typeof requestedGenerateAudio === 'boolean' ? { generateAudio: requestedGenerateAudio } : {}),
      ...(lastFrameImageBase64 ? { lastFrameImageUrl: lastFrameImageBase64 } : {}),
    },
  })

  let downloadHeaders: Record<string, string> | undefined
  const videoSource = generatedVideo.url
  if (generatedVideo.downloadHeaders) {
    downloadHeaders = generatedVideo.downloadHeaders
  } else if (typeof videoSource === 'string') {
    const parsedModel = parseModelKeyStrict(model)
    const isGoogleDownloadUrl = videoSource.includes('generativelanguage.googleapis.com/')
      && videoSource.includes('/files/')
      && videoSource.includes(':download')
    if (parsedModel?.provider === 'google' && isGoogleDownloadUrl) {
      const { apiKey } = await getProviderConfig(job.data.userId, 'google')
      downloadHeaders = { 'x-goog-api-key': apiKey }
    }
  }

  const cosKey = await uploadVideoSourceToCos(videoSource, 'panel-video', panel.id, downloadHeaders)
  return { cosKey, generationMode }
}

async function handleVideoPanelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)

  const modelId = typeof payload.videoModel === 'string' ? payload.videoModel.trim() : ''
  if (!modelId) throw new Error('VIDEO_MODEL_REQUIRED: payload.videoModel is required')

  const panel = await getPanelForVideoTask(job)

  const generationOptions = extractGenerationOptions(payload)

  await reportTaskProgress(job, 10, {
    stage: 'generate_panel_video',
    panelId: panel.id,
  })

  const { cosKey, generationMode } = await generateVideoForPanel(
    job,
    panel,
    payload,
    modelId,
    projectModels.videoRatio,
    generationOptions,
  )

  await assertTaskActive(job, 'persist_panel_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      videoUrl: cosKey,
      videoGenerationMode: generationMode,
    },
  })

  let autoLipSyncTaskId: string | null = null
  const firstLastFramePayload =
    typeof payload.firstLastFrame === 'object' && payload.firstLastFrame !== null
      ? (payload.firstLastFrame as AnyObj)
      : null
  if (
    generationMode === 'firstlastframe' &&
    firstLastFramePayload &&
    typeof firstLastFramePayload.lastFrameStoryboardId === 'string' &&
    firstLastFramePayload.lastFrameStoryboardId &&
    firstLastFramePayload.lastFramePanelIndex !== undefined
  ) {
    const lastPanel = await fetchPanelByStoryboardIndex(
      firstLastFramePayload.lastFrameStoryboardId,
      Number(firstLastFramePayload.lastFramePanelIndex),
    )
    const autoLipSyncResult = await enqueueAutoLipSyncForGeneratedVideo({
      job,
      panel,
      lastPanel,
    })
    autoLipSyncTaskId = autoLipSyncResult?.taskId || null
  }

  return {
    panelId: panel.id,
    videoUrl: cosKey,
    autoLipSyncTaskId,
  }
}

async function handleLipSyncTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lipSyncModel = typeof payload.lipSyncModel === 'string' && payload.lipSyncModel.trim()
    ? payload.lipSyncModel.trim()
    : undefined

  let panel: PanelRecord | null = null
  if (job.data.targetType === 'NovelPromotionPanel') {
    panel = await prisma.novelPromotionPanel.findUnique({ where: { id: job.data.targetId } })
  }

  if (
    !panel &&
    typeof payload.storyboardId === 'string' &&
    payload.storyboardId &&
    payload.panelIndex !== undefined
  ) {
    panel = await fetchPanelByStoryboardIndex(payload.storyboardId, Number(payload.panelIndex))
  }

  if (!panel) throw new Error('Lip-sync panel not found')
  if (!panel.videoUrl) throw new Error('Panel has no base video')

  const voiceLineId = typeof payload.voiceLineId === 'string' ? payload.voiceLineId : null
  if (!voiceLineId) throw new Error('Lip-sync task missing voiceLineId')

  const voiceLine = await prisma.novelPromotionVoiceLine.findUnique({ where: { id: voiceLineId } })
  if (!voiceLine || !voiceLine.audioUrl) {
    throw new Error('Voice line or audioUrl not found')
  }

  const signedVideoUrl = toSignedUrlIfCos(panel.videoUrl, 7200)
  const signedAudioUrl = toSignedUrlIfCos(voiceLine.audioUrl, 7200)

  if (!signedVideoUrl || !signedAudioUrl) {
    throw new Error('Lip-sync input media url invalid')
  }

  await reportTaskProgress(job, 25, { stage: 'submit_lip_sync' })

  const source = await resolveLipSyncVideoSource(job, {
    userId: job.data.userId,
    videoUrl: signedVideoUrl,
    audioUrl: signedAudioUrl,
    audioDurationMs: typeof voiceLine.audioDuration === 'number' ? voiceLine.audioDuration : undefined,
    videoDurationMs: toDurationMs(panel.duration),
    modelKey: lipSyncModel,
  })

  await reportTaskProgress(job, 93, { stage: 'persist_lip_sync' })

  const cosKey = await uploadVideoSourceToCos(source, 'lip-sync', panel.id)

  await assertTaskActive(job, 'persist_lip_sync_video')
  await prisma.novelPromotionPanel.update({
    where: { id: panel.id },
    data: {
      lipSyncVideoUrl: cosKey,
      lipSyncTaskId: null,
    },
  })

  return {
    panelId: panel.id,
    voiceLineId,
    lipSyncVideoUrl: cosKey,
  }
}

async function processVideoTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VIDEO_PANEL:
      return await handleVideoPanelTask(job)
    case TASK_TYPE.LIP_SYNC:
      return await handleLipSyncTask(job)
    default:
      throw new Error(`Unsupported video task type: ${job.data.type}`)
  }
}

export function createVideoWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VIDEO,
    async (job) => await withTaskLifecycle(job, async (taskJob) => {
      const workflowConcurrency = await getUserWorkflowConcurrencyConfig(taskJob.data.userId)
      return await withUserConcurrencyGate({
        scope: 'video',
        userId: taskJob.data.userId,
        limit: workflowConcurrency.video,
        run: async () => await processVideoTask(taskJob),
      })
    }),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VIDEO || '4', 10) || 4,
    },
  )
}
