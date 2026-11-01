/**
 * Gọi mô hình AI (Gemini hoặc OpenAI) và nhận về JSON đúng schema. Dùng chung cho các chức năng AI
 * ngoài trợ lý bản đồ: hỗ trợ điền phiếu, gợi ý lĩnh vực và nhận biết ảnh.
 * Không chọn nhà cung cấp hay mô hình ngầm định: thiếu cấu hình thì chức năng AI tắt.
 */
export interface AiImage {
  mimeType: string;
  data: Buffer;
}

export interface JsonModelRequest {
  instructions: string;
  text: string;
  images?: AiImage[];
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
}

export interface JsonModel {
  readonly provider: 'OpenAI' | 'Gemini';
  readonly model: string;
  generate(request: JsonModelRequest): Promise<unknown>;
}

/** Lỗi kết nối hoặc kết quả không dùng được. Không mang theo nội dung lỗi của nhà cung cấp. */
export class AiUnavailableError extends Error {
  constructor() { super('AI provider unavailable'); }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Đủ chỗ cho phần "suy nghĩ" của các mô hình mới, để JSON không bị cắt giữa chừng.
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export function createJsonModel(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch): JsonModel | undefined {
  const provider = env.AI_PROVIDER;
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : provider === 'gemini' ? env.GEMINI_API_KEY : undefined;
  const model = env.AI_MODEL?.trim();
  if (!apiKey?.trim() || !model || (provider !== 'openai' && provider !== 'gemini')) return undefined;
  const openai = provider === 'openai';
  return {
    provider: openai ? 'OpenAI' : 'Gemini',
    model,
    async generate(request) {
      const maxOutputTokens = request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
      const images = request.images ?? [];
      const endpoint = openai ? 'https://api.openai.com/v1/responses'
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const body = openai ? {
        model, instructions: request.instructions, store: false, max_output_tokens: maxOutputTokens,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: request.text },
            ...images.map((image) => ({ type: 'input_image', image_url: `data:${image.mimeType};base64,${image.data.toString('base64')}` })),
          ],
        }],
        text: { format: { type: 'json_schema', name: request.schemaName, strict: true, schema: request.schema } },
      } : {
        systemInstruction: { parts: [{ text: request.instructions }] },
        contents: [{
          role: 'user',
          parts: [
            { text: request.text },
            ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data.toString('base64') } })),
          ],
        }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: request.schema, maxOutputTokens },
      };
      try {
        const response = await fetcher(endpoint, {
          method: 'POST', signal: AbortSignal.timeout(images.length ? 30_000 : 15_000),
          headers: { 'Content-Type': 'application/json', ...(openai ? { Authorization: `Bearer ${apiKey}` } : { 'x-goog-api-key': apiKey }) },
          body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error('Provider unavailable');
        const payload = await response.json() as Record<string, unknown>;
        let output: unknown;
        if (openai) {
          if (payload.status !== 'completed' || !Array.isArray(payload.output)) throw new Error('Incomplete result');
          const messages = payload.output.map(record).filter((item) => item?.type === 'message');
          const parts = messages.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map(record);
          output = parts.find((part) => part?.type === 'output_text')?.text;
        } else {
          const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          const candidate = record(candidates[0]);
          if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete result');
          const content = record(candidate.content);
          const parts = Array.isArray(content?.parts) ? content.parts.map(record) : [];
          output = parts.filter((part) => part?.thought !== true).map((part) => typeof part?.text === 'string' ? part.text : '').join('');
        }
        if (typeof output !== 'string' || output.length > 16_000) throw new Error('Invalid result');
        return JSON.parse(output) as unknown;
      } catch {
        throw new AiUnavailableError();
      }
    },
  };
}
