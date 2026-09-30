import { GoogleGenAI } from '@google/genai'
import { AiError, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  type ProviderArgs,
} from './shared'

/**
 * Call Google Gemini using the @google/genai SDK.
 * Prioritizes the account's configured BYO API key, falling back to process.env.GEMINI_API_KEY.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const effectiveKey = apiKey || process.env.GEMINI_API_KEY
  if (!effectiveKey) {
    throw new AiError('Google Gemini API key is missing. Configure it in workspace settings or set GEMINI_API_KEY.', {
      code: 'missing_api_key',
      status: 400,
    })
  }

  const ai = new GoogleGenAI({
    apiKey: effectiveKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  })
  const selectedModel = model || 'gemini-2.5-flash'

  // Format conversation turns for Gemini's multi-turn schema (roles: 'user' | 'model')
  const contents = mergeConsecutive(messages).map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }))

  try {
    const abortController = new AbortController()
    const timer = setTimeout(() => abortController.abort(), timeoutMs)

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config: {
        systemInstruction: systemPrompt || undefined,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        abortSignal: abortController.signal,
      },
    })

    clearTimeout(timer)

    const text = response.text
    if (!text || !text.trim()) {
      throw new AiError('Gemini returned an empty reply.', {
        code: 'empty_response',
        status: 502,
      })
    }

    const meta = response.usageMetadata
    const usage = normalizeUsage({
      prompt: meta?.promptTokenCount,
      completion: meta?.candidatesTokenCount,
      total: meta?.totalTokenCount,
    })

    return {
      text: text.trim(),
      usage,
    }
  } catch (err: unknown) {
    if (err instanceof AiError) throw err

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AiError('Google Gemini request timed out.', {
        code: 'timeout',
        status: 504,
      })
    }

    const message = err instanceof Error ? err.message : String(err)
    const isAuthError =
      message.toLowerCase().includes('api key') ||
      message.includes('401') ||
      message.includes('403')
    const isRateLimit =
      message.toLowerCase().includes('quota') ||
      message.includes('429')

    throw new AiError(`Gemini error: ${message}`, {
      code: isAuthError ? 'invalid_key' : isRateLimit ? 'rate_limited' : 'provider_error',
      status: isAuthError ? 401 : isRateLimit ? 429 : 502,
    })
  }
}
