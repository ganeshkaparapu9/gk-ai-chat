// app/api/chat/route.ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { neon } from '@neondatabase/serverless';

// Initialize the provider pointing to NVIDIA instead of OpenAI
const nvidia = createOpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Initialize Neon connection
const sql = neon(process.env.DATABASE_URL!);

// NVIDIA embedding endpoint
const NVIDIA_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const EMBED_MODEL = 'nvidia/nv-embedqa-e5-v5';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

// Generate a single embedding for the user's query
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
    throw new Error(`NVIDIA embedding API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Retrieve the top-K most relevant document chunks (with timeout)
async function retrieveContext(query: string, topK = 3): Promise<string[]> {
  // Race against a 5-second timeout so chat stays responsive
  const timeoutMs = 5000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Quick check: does the documents table exist?
    const tableCheck = await sql`SELECT EXISTS (
      SELECT FROM information_schema.tables WHERE table_name = 'documents'
    )`;
    if (!tableCheck[0]?.exists) return [];

    const questionEmbedding = await getQueryEmbedding(query);
    const queryVector = '[' + questionEmbedding.join(',') + ']';

    const rows = await sql`SELECT text FROM documents ORDER BY embedding <=> ${queryVector}::vector LIMIT ${topK}`;

    return rows.map((row) => row.text as string);
  } catch (error) {
    // If the table doesn't exist yet, DB error, or timeout — just skip RAG
    console.warn('RAG retrieval skipped:', error instanceof Error ? error.message : error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request: messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract the latest user message for RAG retrieval
    const lastUserMessage = [...messages].reverse().find(
      (m: { role: string }) => m.role === 'user'
    );

    // Retrieve relevant context from the vector store
    let contextBlock = '';
    if (lastUserMessage) {
      const relevantChunks = await retrieveContext(lastUserMessage.content);
      if (relevantChunks.length > 0) {
        contextBlock = `\n\nRelevant context from uploaded documents:\n---\n${relevantChunks.join('\n\n')}\n---\nUse the above context to inform your answer when relevant. If the context doesn't relate to the question, ignore it.`;
      }
    }

    const systemPrompt = `You are a highly capable AI assistant. Keep all responses concise, direct, and under 3 sentences unless explicitly asked for more detail.${contextBlock}`;

    const result = await streamText({
      // Specify the exact model string from the NVIDIA Build portal
      model: nvidia.chat('meta/llama-3.1-8b-instruct'),
      // Use messages directly - they're already in { role, content } format
      messages: messages as { role: 'user' | 'assistant'; content: string }[],
      system: systemPrompt,
      temperature: 0.7,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}