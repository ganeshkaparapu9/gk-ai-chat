// app/api/chat/route.ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Initialize the provider pointing to NVIDIA instead of OpenAI
const nvidia = createOpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 60;

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

    const result = await streamText({
      // Specify the exact model string from the NVIDIA Build portal
      model: nvidia.chat('meta/llama-3.1-8b-instruct'),
      // Use messages directly - they're already in { role, content } format
      messages: messages as { role: 'user' | 'assistant'; content: string }[],
      // Optional: Adjust temperature for creativity (0.0 to 1.0)
      system: 'You are a highly capable AI assistant. Keep all responses concise, direct, and under 3 sentences unless explicitly asked for more detail.',
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