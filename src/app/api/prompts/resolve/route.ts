import { NextResponse } from 'next/server'
import { buildPrompt, PROMPT_IDS, type PromptId } from '@/lib/prompt-i18n'
import type { PromptLocale } from '@/lib/prompt-i18n/types'

type ResolvePromptRequest = {
  promptId: PromptId
  locale: PromptLocale
  variables: Record<string, string>
}

const PROMPT_ID_SET = new Set(Object.values(PROMPT_IDS))

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as ResolvePromptRequest | null
  if (!body || !body.promptId || !body.locale || !body.variables) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  if (!PROMPT_ID_SET.has(body.promptId)) {
    return NextResponse.json({ error: 'Unknown promptId' }, { status: 400 })
  }

  try {
    const prompt = buildPrompt({
      promptId: body.promptId,
      locale: body.locale,
      variables: body.variables,
    })
    return NextResponse.json({ prompt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prompt build failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
