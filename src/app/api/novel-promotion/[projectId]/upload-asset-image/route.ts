import { NextRequest, NextResponse } from 'next/server'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import { uploadObject, generateUniqueKey, getSignedUrl } from '@/lib/storage'
import sharp from 'sharp'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface CharacterAppearanceRecord {
  id: string
  imageUrls: string | null
  selectedIndex: number | null
}

interface LocationImageRecord {
  id: string
  imageIndex: number
}

interface LocationRecord {
  selectedImageId: string | null
  images?: LocationImageRecord[]
}

interface PanelRecord {
  id: string
  imageUrl: string | null
}

interface UploadAssetImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findUnique(args: Record<string, unknown>): Promise<LocationRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  locationImage: {
    update(args: Record<string, unknown>): Promise<{ id: string }>
    create(args: Record<string, unknown>): Promise<{ id: string }>
  }
  novelPromotionPanel: {
    findUnique(args: Record<string, unknown>): Promise<PanelRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
}

/**
 * POST /api/novel-promotion/[projectId]/upload-asset-image
 * 上传资产图片，并按需添加标签条。
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const db = prisma as unknown as UploadAssetImageDb

  // 在渲染标签 SVG 前初始化字体。
  await initializeFonts()

  // 轻量权限校验。
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // 解析表单数据。
  const formData = await request.formData()
  const fileValue = formData.get('file')
  const typeValue = formData.get('type')
  const idValue = formData.get('id')
  const appearanceId = formData.get('appearanceId') as string | null  // UUID
  const imageIndex = formData.get('imageIndex') as string | null
  const labelText = (formData.get('labelText') as string | null) ?? '' // 可选标签文案。
  // 在不同运行时环境下，可能是 File 或 Blob
  const isFile = typeof File !== 'undefined' && fileValue instanceof File
  const hasArrayBuffer = !!fileValue && typeof (fileValue as Blob).arrayBuffer === 'function'
  const file = hasArrayBuffer ? (fileValue as Blob) : null
  const fileMeta = isFile ? fileValue : null
  const type = typeof typeValue === 'string' ? typeValue : ''
  const id = typeof idValue === 'string' ? idValue : ''

  const missing = {
    file: !file,
    type: !type,
    id: !id,
    labelText: type !== 'panel' && !labelText,
  }

  if (!file || !type || !id || (type !== 'panel' && !labelText)) {
    _ulogInfo('[UploadAssetImage] invalid params', {
      type,
      id,
      appearanceId,
      imageIndex,
      labelText,
      fileName: fileMeta?.name ?? null,
      fileSize: file?.size ?? null,
      fileValueType: typeof fileValue,
      fileValueCtor: (fileValue as { constructor?: { name?: string } } | null)?.constructor?.name ?? null,
      hasArrayBuffer,
      isFile,
      missing,
    })
    return NextResponse.json(
      {
        success: false,
        code: 'INVALID_PARAMS',
        message: 'Invalid parameters',
        missing,
        fileValueType: typeof fileValue,
        fileValueCtor: (fileValue as { constructor?: { name?: string } } | null)?.constructor?.name ?? null,
        hasArrayBuffer,
        isFile,
      },
      { status: 400 }
    )
  }


  // 读取上传文件为 Buffer。
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 读取图片尺寸用于标签布局。
  const meta = await sharp(buffer).metadata()
  const w = meta.width || 2160
  const h = meta.height || 2160
  const fontSize = Math.floor(h * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barH = fontSize + pad * 2

  // 构建标签条 SVG。
  const svg = await createLabelSVG(w, barH, fontSize, pad, labelText)

  // 非 panel 类型添加标签条，否则仅重新编码。
  let processed
  if (type !== 'panel') {
    processed = await sharp(buffer)
      .extend({ top: barH, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .composite([{ input: svg, top: 0, left: 0 }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
  } else {
    processed = await sharp(buffer)
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer()
  }

  // 生成存储 key 并上传。
  const keyPrefix = type === 'character'
    ? `char-${id}-${appearanceId}-upload`
    : `loc-${id}-upload`
  const key = generateUniqueKey(keyPrefix, 'jpg')
  await uploadObject(processed, key)
  const signedUrl = getSignedUrl(key, 7 * 24 * 3600)

  // 将图片链接写入数据库。
  if (type === 'character' && appearanceId !== null) {
    // 角色外观：确保记录存在。
    const appearance = await db.characterAppearance.findUnique({
      where: { id: appearanceId }
    })

    if (!appearance) {
      throw new ApiError('NOT_FOUND')
    }

    // 解码图片 URL 列表。
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

    // 选择目标槽位（未指定索引则追加）。
    const targetIndex = imageIndex !== null ? parseInt(imageIndex) : imageUrls.length

    // 确保数组长度足够。
    while (imageUrls.length <= targetIndex) {
      imageUrls.push('')
    }

    imageUrls[targetIndex] = key

    // 选中槽位变化或首图时更新主图链接。

    const selectedIndex = appearance.selectedIndex
    const shouldUpdateImageUrl =
      selectedIndex === targetIndex ||
      (selectedIndex === null && targetIndex === 0) ||
      imageUrls.filter(u => !!u).length === 1

    const updateData: Record<string, unknown> = {
      imageUrls: encodeImageUrls(imageUrls)
    }

    if (shouldUpdateImageUrl) {
      updateData.imageUrl = key
    }

    // 保存外观更新。
    await db.characterAppearance.update({
      where: { id: appearance.id },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageUrl: signedUrl,
      imageIndex: targetIndex
    })

  } else if (type === 'location') {
    // 场景图片。
    const location = await db.novelPromotionLocation.findUnique({
      where: { id },
      include: { images: { orderBy: { imageIndex: 'asc' } } }
    })

    if (!location) {
      throw new ApiError('NOT_FOUND')
    }

    // 指定索引时更新或创建该位置。
    if (imageIndex !== null) {
      const targetImageIndex = parseInt(imageIndex)
      const existingImage = location.images?.find((img) => img.imageIndex === targetImageIndex)

      if (existingImage) {
        const updated = await db.locationImage.update({
          where: { id: existingImage.id },
          data: { imageUrl: key }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: updated.id }
          })
        }
      } else {
        const created = await db.locationImage.create({
          data: {
            locationId: id,
            imageIndex: targetImageIndex,
            imageUrl: key,
            description: labelText,
            isSelected: targetImageIndex === 0
          }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: created.id }
          })
        }
      }

      return NextResponse.json({
        success: true,
        imageKey: key,
        imageUrl: signedUrl,
        imageIndex: targetImageIndex
      })
    } else {
      // 追加为末尾新图片。
      const maxIndex = location.images?.length || 0
      const created = await db.locationImage.create({
        data: {
          locationId: id,
          imageIndex: maxIndex,
          imageUrl: key,
          description: labelText,
          isSelected: maxIndex === 0
        }
      })
      if (!location.selectedImageId) {
        await prisma.novelPromotionLocation.update({
          where: { id },
          data: { selectedImageId: created.id }
        })
      }

      return NextResponse.json({
        success: true,
        imageKey: key,
        imageUrl: signedUrl,
        imageIndex: maxIndex
      })
    }
  } else if (type === 'panel') {
    const panel = await db.novelPromotionPanel.findUnique({
      where: { id }
    })

    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }

    const updateData: Record<string, unknown> = {
      imageUrl: key,
      candidateImages: null
    }

    if (panel.imageUrl) {
      updateData.previousImageUrl = panel.imageUrl
    }

    await db.novelPromotionPanel.update({
      where: { id: panel.id },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageUrl: signedUrl
    })
  }

  throw new ApiError('INVALID_PARAMS')
})



