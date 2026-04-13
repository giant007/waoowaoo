'use client'

import { useState } from 'react'
import { NovelPromotionStoryboard, NovelPromotionClip } from '@/types/project'
import { CharacterPickerModal, LocationPickerModal } from '../PanelEditForm'
import ImageEditModal from './ImageEditModal'
import AIDataModal from './AIDataModal'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import StoryboardStageShell from './StoryboardStageShell'
import StoryboardToolbar from './StoryboardToolbar'
import StoryboardCanvas from './StoryboardCanvas'
import { useStoryboardStageController } from './hooks/useStoryboardStageController'
import { useStoryboardModalRuntime } from './hooks/useStoryboardModalRuntime'

interface StoryboardStageProps {
  projectId: string
  episodeId: string
  storyboards: NovelPromotionStoryboard[]
  clips: NovelPromotionClip[]
  videoRatio: string
  onBack: () => void
  onNext: () => void
  isTransitioning?: boolean
}

export default function StoryboardStage({
  projectId,
  episodeId,
  storyboards: initialStoryboards,
  clips,
  videoRatio,
  onBack,
  onNext,
  isTransitioning = false,
}: StoryboardStageProps) {
  const [isExportingDescriptions, setIsExportingDescriptions] = useState(false)
  const controller = useStoryboardStageController({
    projectId,
    episodeId,
    initialStoryboards,
    clips,
    isTransitioning,
  })

  const {
    characters,
    locations,
    localStoryboards,
    setLocalStoryboards,
    sortedStoryboards,
    expandedClips,
    toggleExpandedClip,
    getClipInfo,
    getTextPanels,
    getPanelEditData,
    updatePanelEdit,
    formatClipTitle,
    totalPanels,
    storyboardStartIndex,

    savingPanels,
    deletingPanelIds,
    saveStateByPanel,
    hasUnsavedByPanel,
    submittingStoryboardTextIds,
    addingStoryboardGroup,
    movingClipId,
    insertingAfterPanelId,
    savePanelWithData,
    addPanel,
    deletePanel,
    deleteStoryboard,
    regenerateStoryboardText,
    addStoryboardGroup,
    moveStoryboardGroup,
    insertPanel,

    submittingVariantPanelId,
    generatePanelVariant,

    submittingStoryboardIds,
    submittingPanelImageIds,
    selectingCandidateIds,

    editingPanel,
    setEditingPanel,
    modifyingPanels,
    isDownloadingImages,
    previewImage,
    setPreviewImage,
    regeneratePanelImage,
    regenerateAllPanelsIndividually,
    selectPanelCandidate,
    selectPanelCandidateIndex,
    cancelPanelCandidate,
    getPanelCandidates,
    downloadAllImages,
    clearStoryboardError,

    assetPickerPanel,
    setAssetPickerPanel,
    aiDataPanel,
    setAIDataPanel,
    isEpisodeBatchSubmitting,

    getDefaultAssetsForClip,
    handleEditSubmit,
    handlePanelUpdate,
    handleAddCharacter,
    handleSetLocation,
    handleRemoveCharacter,
    handleRemoveLocation,
    retrySave,

    updatePhotographyPlanMutation,
    updatePanelActingNotesMutation,

    addingStoryboardGroupState,
    transitioningState,
    runningCount,
    pendingPanelCount,
    handleGenerateAllPanels,
  } = controller

  const modalRuntime = useStoryboardModalRuntime({
    projectId,
    videoRatio,
    localStoryboards,
    editingPanel,
    setEditingPanel,
    assetPickerPanel,
    setAssetPickerPanel,
    aiDataPanel,
    setAIDataPanel,
    previewImage,
    setPreviewImage,
    getTextPanels,
    getPanelEditData,
    updatePanelEdit,
    savePanelWithData,
    getDefaultAssetsForClip,
    handleEditSubmit,
    handleAddCharacter,
    handleSetLocation,
    updatePhotographyPlanMutation,
    updatePanelActingNotesMutation,
  })

  const handleExportDescriptions = () => {
    const parseJson = <T,>(value: string | null | undefined): T | null => {
      if (!value) return null
      try {
        return JSON.parse(value) as T
      } catch {
        return null
      }
    }

    const normalizeText = (value: string | null | undefined) => (value || '').trim()
    const normalizeExportLocation = (value: string | null | undefined) => {
      const normalized = normalizeText(value)
      if (!normalized) return ''
      return normalized.split('_')[0].trim()
    }
    const cleanDescription = (description: string) => description.replace(/^.{0,2}景[：:]/, '').trim()
    const exportPrefix =
      '下面是剧本几个分镜，帮我生成以下几张基于参考图的分镜图片,每个分镜生成三张图片，用于生成视频。prompt的人物/场景跟参考图右上角文字描述对应，**清除右上角的文字和标注**，画面无任何文字，背景纯净，保留人物核心特征。考虑运镜的合理性。比例「9:16」图片风格为「电影写真」'

    const panels = sortedStoryboards.flatMap((storyboard) => getTextPanels(storyboard))
    if (panels.length === 0) {
      return
    }

    const characterNames = Array.from(
      new Set(
        panels
          .flatMap((panel) => panel.characters || [])
          .map((character) => normalizeText(character.name))
          .filter(Boolean),
      ),
    )

    const lines = panels.map((panel, index) => {
      const photographyRules = parseJson<{
        lighting?: {
          direction?: string
          quality?: string
        }
      }>(panel.photographyRules)
      const actingNotes = parseJson<Array<{ name?: string; acting?: string }>>(panel.actingNotes) || []

      const characters = (panel.characters || []).map((character) => normalizeText(character.name)).filter(Boolean)
      const lightingDirection = normalizeText(photographyRules?.lighting?.direction)
      const lightingQuality = normalizeText(photographyRules?.lighting?.quality)
      const shotType = normalizeText(panel.shot_type)
      const location = normalizeExportLocation(panel.location)
      const description = normalizeText(panel.description)

      const lightingText = [lightingDirection, lightingQuality].filter(Boolean).join('，')
      const characterLightingSegments = characters.map(
        (name) => `人物描述：${name}${lightingText ? `，${lightingText}` : ''}`,
      )

      const actingSegments = actingNotes
        .map((note) => {
          const name = normalizeText(note.name)
          const acting = normalizeText(note.acting)
          if (!acting) return ''
          return `${name || '人物'}动作：${acting}`
        })
        .filter(Boolean)

      const body = [
        ...characterLightingSegments,
        ...actingSegments,
        description ? `画面描述：${cleanDescription(description)}` : '',
      ]
        .filter(Boolean)
        .join('；')

      const header = [shotType, location ? `场景：${location}` : ''].filter(Boolean).join('，')
      return `分镜${index + 1}：\n${header}${body ? `；${body}` : ''}`
    })

    setIsExportingDescriptions(true)
    try {
      const content = [
        exportPrefix,
        '',
        '【人物】',
        characterNames.join('、') || '无',
        '【分镜prompt】',
        ...lines,
      ].join('\n')
      const blob = new Blob([content], {
        type: 'text/plain;charset=utf-8',
      })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `storyboard-descriptions_${new Date().toISOString().slice(0, 10)}.txt`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    } finally {
      setIsExportingDescriptions(false)
    }
  }
  return (
      <StoryboardStageShell
        isTransitioning={isTransitioning}
        isNextDisabled={isTransitioning || localStoryboards.length === 0}
        transitioningState={transitioningState}
        onNext={onNext}
      >
        <StoryboardToolbar
          totalSegments={sortedStoryboards.length}
          totalPanels={totalPanels}
          isDownloadingImages={isDownloadingImages}
          isExportingDescriptions={isExportingDescriptions}
          runningCount={runningCount}
          pendingPanelCount={pendingPanelCount}
          isBatchSubmitting={isEpisodeBatchSubmitting}
          addingStoryboardGroup={addingStoryboardGroup}
          addingStoryboardGroupState={addingStoryboardGroupState}
          onDownloadAllImages={downloadAllImages}
          onExportDescriptions={handleExportDescriptions}
          onGenerateAllPanels={handleGenerateAllPanels}
          onAddStoryboardGroupAtStart={() => addStoryboardGroup(0)}
          onBack={onBack}
        />

        <StoryboardCanvas
          characters={characters}
          locations={locations}
          sortedStoryboards={sortedStoryboards}
          videoRatio={videoRatio}
          expandedClips={expandedClips}
          submittingStoryboardIds={submittingStoryboardIds}
          selectingCandidateIds={selectingCandidateIds}
          submittingStoryboardTextIds={submittingStoryboardTextIds}
          savingPanels={savingPanels}
          deletingPanelIds={deletingPanelIds}
          saveStateByPanel={saveStateByPanel}
          hasUnsavedByPanel={hasUnsavedByPanel}
          modifyingPanels={modifyingPanels}
          submittingPanelImageIds={submittingPanelImageIds}

          movingClipId={movingClipId}
          insertingAfterPanelId={insertingAfterPanelId}
          submittingVariantPanelId={submittingVariantPanelId}
          projectId={projectId}
          episodeId={episodeId}
          storyboardStartIndex={storyboardStartIndex}
          getClipInfo={getClipInfo}
          getTextPanels={getTextPanels}
          getPanelEditData={getPanelEditData}
          formatClipTitle={formatClipTitle}
          onToggleExpandedClip={toggleExpandedClip}
          onMoveStoryboardGroup={moveStoryboardGroup}
          onRegenerateStoryboardText={regenerateStoryboardText}
          onAddPanel={addPanel}
          onDeleteStoryboard={deleteStoryboard}
          onGenerateAllIndividually={regenerateAllPanelsIndividually}
          onPreviewImage={setPreviewImage}
          onCloseStoryboardError={clearStoryboardError}
          onPanelUpdate={handlePanelUpdate}
          onPanelDelete={deletePanel}
          onOpenCharacterPicker={(panelId) => setAssetPickerPanel({ panelId, type: 'character' })}
          onOpenLocationPicker={(panelId) => setAssetPickerPanel({ panelId, type: 'location' })}
          onRemoveCharacter={handleRemoveCharacter}
          onRemoveLocation={handleRemoveLocation}
          onRetryPanelSave={retrySave}
          onRegeneratePanelImage={regeneratePanelImage}
          onOpenEditModal={(storyboardId, panelIndex) => setEditingPanel({ storyboardId, panelIndex })}
          onOpenAIDataModal={(storyboardId, panelIndex) => setAIDataPanel({ storyboardId, panelIndex })}
          getPanelCandidates={getPanelCandidates}
          onSelectPanelCandidateIndex={selectPanelCandidateIndex}
          onConfirmPanelCandidate={selectPanelCandidate}
          onCancelPanelCandidate={cancelPanelCandidate}

          onInsertPanel={insertPanel}
          onPanelVariant={generatePanelVariant}
          addStoryboardGroup={addStoryboardGroup}
          addingStoryboardGroup={addingStoryboardGroup}
          setLocalStoryboards={setLocalStoryboards}
        />

        {modalRuntime.editingPanel && (
          <ImageEditModal
            projectId={modalRuntime.projectId}
            defaultAssets={modalRuntime.imageEditDefaults}
            onSubmit={modalRuntime.handleEditSubmit}
            onClose={modalRuntime.closeImageEditModal}
          />
        )}

        {modalRuntime.aiDataPanel && modalRuntime.aiDataRuntime && (
          <AIDataModal
            isOpen={true}
            onClose={modalRuntime.closeAIDataModal}
            syncKey={modalRuntime.aiDataRuntime.panel.id}
            panelNumber={modalRuntime.aiDataRuntime.panelData.panelNumber || modalRuntime.aiDataPanel.panelIndex + 1}
            shotType={modalRuntime.aiDataRuntime.panelData.shotType}
            cameraMove={modalRuntime.aiDataRuntime.panelData.cameraMove}
            description={modalRuntime.aiDataRuntime.panelData.description}
            location={modalRuntime.aiDataRuntime.panelData.location}
            characters={modalRuntime.aiDataRuntime.characterNames}
            videoPrompt={modalRuntime.aiDataRuntime.panelData.videoPrompt}
            photographyRules={modalRuntime.aiDataRuntime.photographyRules}
            actingNotes={modalRuntime.aiDataRuntime.actingNotes}
            videoRatio={modalRuntime.videoRatio}
            onSave={modalRuntime.handleSaveAIData}
          />
        )}

        {modalRuntime.previewImage && (
          <ImagePreviewModal imageUrl={modalRuntime.previewImage} onClose={modalRuntime.closePreviewImage} />
        )}

        {modalRuntime.hasCharacterPicker && (
          <CharacterPickerModal
            projectId={projectId}
            currentCharacters={modalRuntime.pickerPanelRuntime ? getPanelEditData(modalRuntime.pickerPanelRuntime.panel).characters : []}
            onSelect={modalRuntime.handleAddCharacter}
            onClose={modalRuntime.closeAssetPicker}
          />
        )}

        {modalRuntime.hasLocationPicker && (
          <LocationPickerModal
            projectId={projectId}
            currentLocation={modalRuntime.pickerPanelRuntime ? getPanelEditData(modalRuntime.pickerPanelRuntime.panel).location || null : null}
            onSelect={modalRuntime.handleSetLocation}
            onClose={modalRuntime.closeAssetPicker}
          />
        )}
      </StoryboardStageShell>
  )
}

