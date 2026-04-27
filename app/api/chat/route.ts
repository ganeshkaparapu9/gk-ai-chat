// app/api/chat/route.ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, convertToModelMessages } from 'ai';

// Initialize the provider pointing to NVIDIA instead of OpenAI
const nvidia = createOpenAI({
  baseURL: 'https://integrate.api.nvidia.com/v1',
  apiKey: process.env.NVIDIA_API_KEY,
});

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages } = await req.json();

  try {
    const result = await streamText({
      // Specify the exact model string from the NVIDIA Build portal
      model: nvidia.chat('meta/llama-3.1-8b-instruct'),
      // Convert UIMessages (from useChat) to ModelMessages (for streamText)
      messages: await convertToModelMessages(messages),
      // Optional: Adjust temperature for creativity (0.0 to 1.0)
      system: 'You are a highly capable AI assistant. Keep all responses concise, direct, and under 3 sentences unless explicitly asked for more detail.',
      temperature: 0.7,
      onError: (error) => {
        console.error('streamText error:', error);
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error('Chat API error:', error);
    return new Response(JSON.stringify({ error: (error as Error)?.message ?? 'Unknown error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}