// app/api/ingest/route.ts
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// NVIDIA embedding endpoint
const NVIDIA_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5';

export const maxDuration = 60;

// Simple text chunker — splits text into overlapping chunks
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

// Generate embeddings via NVIDIA API
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
    throw new Error(`NVIDIA embedding API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text } = body;

    if (!text || typeof text !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Invalid request: "text" string is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Ensure the documents table exists with pgvector
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      text TEXT NOT NULL,
      embedding vector(1024)
    )`;

    // 2. Chunk the document
    const chunks = chunkText(text);

    // 3. Generate embeddings for all chunks (batch)
    const embeddings = await getEmbeddings(chunks);

    // 4. Insert each chunk + embedding into Neon
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const vector = embeddings[i];
      const embeddingString = '[' + vector.join(',') + ']';
      await sql`INSERT INTO documents (text, embedding) VALUES (${chunkContent}, ${embeddingString}::vector)`;
      inserted++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        chunksInserted: inserted,
        totalChunks: chunks.length,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Ingest API error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
