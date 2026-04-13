import { getArtStylePrompt } from '@/lib/constants'
import type { Character, CharacterAppearance, Location } from '@/types/project'

export type SupportedLocale = 'zh' | 'en'
export type PromptId = 'np_single_panel_image' | 'np_agent_shot_variant_generate'

const PROMPT_IDS = {
  NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image' as const,
  NP_AGENT_SHOT_VARIANT_GENERATE: 'np_agent_shot_variant_generate' as const,
}

export interface PanelPromptSource {
  id: string
  shotType?: string | null
  cameraMove?: string | null
  description?: string | null
  videoPrompt?: string | null
  location?: string | null
  characters?: Array<{ name: string; appearance?: string | null }> | string | null
  srtSegment?: string | null
  photographyRules?: string | null
  actingNotes?: string | null
}

export interface PromptPayload {
  promptId: PromptId
  locale: SupportedLocale
  variables: Record<string, string>
}

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseDescriptionList(raw: string | string[] | null | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  }
  if (typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function pickAppearanceDescription(appearance: {
  descriptions?: string[] | string | null
  description?: string | null
  selectedIndex?: number | null
}): string {
  const descriptions = parseDescriptionList(appearance.descriptions || null)
  if (descriptions.length > 0) {
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const selected = descriptions[selectedIndex] || descriptions[0]
    if (selected && selected.trim()) return selected.trim()
  }
  if (typeof appearance.description === 'string' && appearance.description.trim()) {
    return appearance.description.trim()
  }
  return '\u65e0\u63cf\u8ff0'
}

function parsePanelCharacterReferences(
  value: PanelPromptSource['characters'],
): Array<{ name: string; appearance?: string }> {
  if (!value) return []
  if (Array.isArray(value)) {
    return value
      .filter((item): item is { name: string; appearance?: string | null } =>
        !!item && typeof item.name === 'string' && item.name.trim().length > 0,
      )
      .map((item) => ({
        name: item.name,
        appearance: item.appearance ?? undefined,
      }))
  }
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown; appearance?: unknown }
        if (typeof candidate.name === 'string') {
          return {
            name: candidate.name,
            appearance: typeof candidate.appearance === 'string' ? candidate.appearance : undefined,
          }
        }
        return null
      })
      .filter(Boolean) as Array<{ name: string; appearance?: string }>
  } catch {
    return []
  }
}

function findCharacterByName<T extends { name: string }>(characters: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined

  const exact = characters.find((c) => c.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  const refAliases = refLower.split('/').map((s) => s.trim()).filter(Boolean)
  for (const character of characters) {
    const charAliases = character.name.toLowerCase().split('/').map((s) => s.trim()).filter(Boolean)
    const hasOverlap = refAliases.some((refAlias) => charAliases.includes(refAlias))
    if (hasOverlap) return character
  }

  return undefined
}

function resolveAppearanceForReference(
  appearances: CharacterAppearance[],
  appearanceName?: string,
) {
  if (!appearances.length) return null
  if (appearanceName) {
    const matched = appearances.find(
      (appearance) => (appearance.changeReason || '').toLowerCase() === appearanceName.toLowerCase(),
    )
    if (matched) return matched
  }
  return appearances[0] || null
}

function buildPanelPromptContext(params: {
  panel: PanelPromptSource
  characters: Character[]
  locations: Location[]
}) {
  const panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const characterContexts = panelCharacters.map((reference) => {
    const character = findCharacterByName(params.characters || [], reference.name)
    if (!character) {
      return {
        name: reference.name,
        appearance: reference.appearance || null,
        description: '\u65e0\u89d2\u8272\u5916\u8c8c\u6570\u636e',
      }
    }

    const matchedAppearance = resolveAppearanceForReference(character.appearances || [], reference.appearance)
    return {
      name: character.name,
      appearance: matchedAppearance?.changeReason || null,
      description: matchedAppearance ? pickAppearanceDescription(matchedAppearance) : '\u65e0\u89d2\u8272\u5916\u8c8c\u6570\u636e',
    }
  })

  const locationContext = (() => {
    if (!params.panel.location) return null
    const matchedLocation = (params.locations || []).find(
      (item) => item.name.toLowerCase() === params.panel.location!.toLowerCase(),
    )
    if (!matchedLocation) return null
    const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
    return {
      name: matchedLocation.name,
      description: selectedImage?.description || null,
    }
  })()

  return {
    panel: {
      // panel_id: params.panel.id,
      shot_type: params.panel.shotType || '',
      camera_move: params.panel.cameraMove || '',
      description: params.panel.description || '',
      // video_prompt: params.panel.videoPrompt || '',
      location: params.panel.location || '',
      characters: panelCharacters,
      source_text: params.panel.srtSegment || '',
      photography_rules: parseJsonUnknown(params.panel.photographyRules),
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
    },
    // context: {
    //   character_appearances: characterContexts,
    //   location_reference: locationContext,
    // },
  }
}

export function buildStoryboardImagePromptPayload(params: {
  locale: SupportedLocale
  aspectRatio: string
  artStyle: string | null | undefined
  panel: PanelPromptSource
  characters: Character[]
  locations: Location[]
}): PromptPayload {
  const artStyleText = getArtStylePrompt(params.artStyle, params.locale)
  const promptContext = buildPanelPromptContext({
    panel: params.panel,
    characters: params.characters,
    locations: params.locations,
  })
  const contextJson = JSON.stringify(promptContext, null, 2)
  const sourceText = params.panel.srtSegment || params.panel.description || ''

  return {
    promptId: PROMPT_IDS.NP_SINGLE_PANEL_IMAGE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_text_json_input: contextJson,
      source_text: sourceText || '\u65e0',
      style: artStyleText || '\u4e0e\u53c2\u8003\u56fe\u98ce\u683c\u4e00\u81f4',
    },
  }
}

function buildCharactersInfo(
  panel: PanelPromptSource,
  characters: Character[],
  locale: SupportedLocale,
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return locale === 'en' ? 'No characters' : '\u65e0\u89d2\u8272'

  return panelCharacters.map((item) => {
    const character = findCharacterByName(characters || [], item.name)
    const intro = character?.introduction || ''
    const appearance = item.appearance || (locale === 'en' ? 'Default appearance' : '\u9ed8\u8ba4\u5f62\u8c61')
    return `- ${item.name}, ${appearance}${intro ? `, ${intro}` : ''}`
  }).join('\n')
}

function buildCharacterAssetsDescription(
  panel: PanelPromptSource,
  characters: Character[],
  locale: SupportedLocale,
): string {
  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  if (panelCharacters.length === 0) return locale === 'en' ? 'No character references' : '\u65e0\u89d2\u8272\u53c2\u8003\u56fe'

  return panelCharacters.map((item) => {
    const character = findCharacterByName(characters || [], item.name)
    if (!character) return `- ${item.name}, ${locale === 'en' ? 'No reference images' : '\u65e0\u53c2\u8003\u56fe'}`
    const hasAppearance = (character.appearances || []).length > 0
    return `- ${item.name}, ${hasAppearance ? (locale === 'en' ? 'Reference images provided' : '\u5df2\u63d0\u4f9b\u53c2\u8003\u56fe') : (locale === 'en' ? 'No reference images' : '\u65e0\u53c2\u8003\u56fe')}`
  }).join('\n')
}

function buildLocationAssetDescription(params: {
  includeLocationAsset: boolean
  locationName: string
  locale: SupportedLocale
}): string {
  if (params.locationName) {
    if (params.includeLocationAsset) {
      return params.locale === 'en'
        ? `Location: ${params.locationName}`
        : `\u573a\u666f\uff1a${params.locationName}`
    }
    return params.locale === 'en' ? 'Location reference disabled' : '\u672a\u4f7f\u7528\u573a\u666f\u53c2\u8003\u56fe'
  }
  return params.locale === 'en' ? 'No location reference' : '\u65e0\u573a\u666f\u53c2\u8003'
}

function buildVariantPromptPayload(params: {
  locale: SupportedLocale
  originalDescription: string
  originalShotType: string
  originalCameraMove: string
  location: string
  charactersInfo: string
  variantTitle: string
  variantDescription: string
  targetShotType: string
  targetCameraMove: string
  videoPrompt: string
  characterAssets: string
  locationAsset: string
  aspectRatio: string
  style: string
}): PromptPayload {
  return {
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_GENERATE,
    locale: params.locale,
    variables: {
      original_description: params.originalDescription,
      original_shot_type: params.originalShotType,
      original_camera_move: params.originalCameraMove,
      location: params.location,
      characters_info: params.charactersInfo,
      variant_title: params.variantTitle,
      variant_description: params.variantDescription,
      target_shot_type: params.targetShotType,
      target_camera_move: params.targetCameraMove,
      video_prompt: params.videoPrompt,
      character_assets: params.characterAssets,
      location_asset: params.locationAsset,
      aspect_ratio: params.aspectRatio,
      style: params.style,
    },
  }
}

export function buildStoryboardVariantPromptPayload(params: {
  locale: SupportedLocale
  aspectRatio: string
  artStyle: string | null | undefined
  panel: PanelPromptSource
  characters: Character[]
  includeCharacterAssets?: boolean
  includeLocationAsset?: boolean
}): PromptPayload {
  const includeCharacterAssets = params.includeCharacterAssets !== false
  const includeLocationAsset = params.includeLocationAsset !== false
  const locationName = params.panel.location || ''

  const charactersInfo = buildCharactersInfo(params.panel, params.characters, params.locale)
  const characterAssetsDesc = includeCharacterAssets
    ? buildCharacterAssetsDescription(params.panel, params.characters, params.locale)
    : (params.locale === 'en' ? 'Character reference images disabled' : '\u672a\u4f7f\u7528\u89d2\u8272\u53c2\u8003\u56fe')

  const artStyleText = getArtStylePrompt(params.artStyle, params.locale)

  return buildVariantPromptPayload({
    locale: params.locale,
    originalDescription: params.panel.description || '',
    originalShotType: params.panel.shotType || '',
    originalCameraMove: params.panel.cameraMove || '',
    location: locationName,
    charactersInfo,
    variantTitle: params.locale === 'en' ? 'Shot Variant' : '\u955c\u5934\u53d8\u4f53',
    variantDescription: params.panel.description || '',
    targetShotType: params.panel.shotType || '',
    targetCameraMove: params.panel.cameraMove || '',
    videoPrompt: params.panel.videoPrompt || '',
    characterAssets: characterAssetsDesc,
    locationAsset: buildLocationAssetDescription({
      includeLocationAsset,
      locationName,
      locale: params.locale,
    }),
    aspectRatio: params.aspectRatio,
    style: artStyleText || '\u4e0e\u53c2\u8003\u56fe\u98ce\u683c\u4e00\u81f4',
  })
}
