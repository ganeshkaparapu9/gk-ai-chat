import { neon } from '@neondatabase/serverless';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { z } from 'zod';
import crypto from 'crypto';

const sql = neon(process.env.DATABASE_URL!);

const NVIDIA_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5';

export const maxDuration = 60;

const requestSchema = z.object({
  text: z.string().min(1).max(200_000),
});

let ratelimit: Ratelimit | null = null;

function getRatelimit(): Ratelimit | null {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  if (!ratelimit) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(5, '1 m'),
    });
  }
  return ratelimit;
}

function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end).trim());
    start += chunkSize - overlap;
  }
  return chunks.filter(c => c.length > 0);
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(NVIDIA_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      input_type: 'passage',
      encoding_format: 'float',
      truncate: 'END',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response('Unauthorized', { status: 401 });
    }

    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    const role = (user.publicMetadata as { role?: string })?.role;
    console.log('User role:', role);
    if (role !== 'admin') {
      return new Response('Forbidden', { status: 403 });
    }

    const limiter = getRatelimit();
    if (limiter) {
      const { success } = await limiter.limit(`ingest:${userId}`);
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

    const { text } = parsed.data;

    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      embedding vector(1024)
    )`;
    // Migrate existing table — safe to run repeatedly, skips if columns already exist
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS ingested_by TEXT`;
    await sql`ALTER TABLE documents ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS documents_content_hash_idx ON documents(content_hash)`;

    const chunks = chunkText(text);
    const embeddings = await getEmbeddings(chunks);

    let inserted = 0;
    let skipped = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const hash = crypto.createHash('sha256').update(chunkContent).digest('hex');
      const vector = embeddings[i];
      const embeddingString = '[' + vector.join(',') + ']';

      const existing = await sql`SELECT id FROM documents WHERE content_hash = ${hash} LIMIT 1`;
      if (existing.length > 0) {
        skipped++;
        continue;
      }

      await sql`INSERT INTO documents (text, embedding, content_hash, ingested_by)
                VALUES (${chunkContent}, ${embeddingString}::vector, ${hash}, ${userId})`;
      inserted++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunksInserted: inserted,
        chunksSkipped: skipped,
        totalChunks: chunks.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Ingest API error:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred processing your request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
