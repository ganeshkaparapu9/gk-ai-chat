// api/chat/route.ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type ModelMessage } from 'ai';
import { neon } from '@neondatabase/serverless';
import { auth } from '@clerk/nextjs/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';

const nvidia = createOpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

const sql = neon(process.env.DATABASE_URL!);

const NVIDIA_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5';

export const maxDuration = 60;

const MAX_CONTEXT_MESSAGES = 20;

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(10_000),
});

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
});

function truncateMessages(msgs: ModelMessage[]): ModelMessage[] {
  if (msgs.length <= MAX_CONTEXT_MESSAGES) return msgs;
  return msgs.slice(-MAX_CONTEXT_MESSAGES);
}

let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(20, '1 m'),
    });
  }
  return ratelimit;
}

async function getQueryEmbedding(text: string): Promise<number[]> {
  const response = await fetch(NVIDIA_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [text],
      input_type: 'query',
      encoding_format: 'float',
      truncate: 'END',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function retrieveContext(query: string, topK = 3): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const tableCheck = await sql`SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'documents'
    )`;
    if (!tableCheck[0]?.exists) return [];

    const questionEmbedding = await getQueryEmbedding(query);
    const queryVector = '[' + questionEmbedding.join(',') + ']';
    const rows = await sql`SELECT text FROM documents ORDER BY embedding <=> ${queryVector}::vector LIMIT ${topK}`;
    return rows.map((row) => row.text as string);
  } catch (error) {
    console.warn('RAG retrieval skipped:', error instanceof Error ? error.message : error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();

    const limiter = getRatelimit();
    if (limiter) {
      const identifier = userId ?? req.headers.get('x-forwarded-for') ?? 'anonymous';
      const { success } = await limiter.limit(`chat:${identifier}`);
      if (!success) {
        return new Response('Too many requests', { status: 429 });
      }
    }

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { messages } = parsed.data;

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');

    let contextBlock = '';
    if (lastUserMessage) {
      const relevantChunks = await retrieveContext(lastUserMessage.content);
      if (relevantChunks.length > 0) {
        contextBlock = `\n\nRelevant context from uploaded documents:\n---\n${relevantChunks.join('\n\n')}\n---\nUse the above context to inform your answer when relevant. If the context doesn't relate to the question, ignore it.`;
      }
    }

    const systemPrompt = `You are a highly capable AI assistant. Keep all responses concise, direct, and under 3 sentences unless explicitly asked for more detail.${contextBlock}`;

    const result = await streamText({
      model: nvidia.chat('meta/llama-3.1-8b-instruct'),
      messages: truncateMessages(messages as ModelMessage[]),
      system: systemPrompt,
      temperature: 0.7,
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}