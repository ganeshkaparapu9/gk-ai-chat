import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const TTL_SECONDS = 3 * 24 * 60 * 60;

let redis: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redis) return redis;
  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    redis = new Redis({ url, token });
    return redis;
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    return null;
  }
}

type Conversation = {
  id: string;
  name: string;
  [key: string]: unknown;
};

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const redisClient = getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ message: 'Redis not configured', conversations: [] });
    }

    const conversations = await redisClient.get(`chat:${userId}:conversations`);
    return NextResponse.json({ conversations: conversations ?? [] });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ conversations: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const conversations = await request.json();
    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json({ message: 'Redis not configured', success: true });
    }

    await redisClient.setex(`chat:${userId}:conversations`, TTL_SECONDS, JSON.stringify(conversations));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving conversations:', error);
    return NextResponse.json({ success: true });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const { conversationId, name } = await request.json();
    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json({ message: 'Redis not configured' });
    }

    const key = `chat:${userId}:conversations`;
    const conversations = await redisClient.get(key);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const updated = (conversations as Conversation[]).map(conv =>
      conv.id === conversationId ? { ...conv, name } : conv
    );

    await redisClient.setex(key, TTL_SECONDS, JSON.stringify(updated));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating conversation:', error);
    return NextResponse.json({ success: true });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversation ID' }, { status: 400 });
    }

    const redisClient = getRedisClient();
    if (!redisClient) {
      return NextResponse.json({ success: true });
    }

    const key = `chat:${userId}:conversations`;
    const conversations = await redisClient.get(key);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const filtered = (conversations as Conversation[]).filter(c => c.id !== conversationId);
    await redisClient.setex(key, TTL_SECONDS, JSON.stringify(filtered));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ success: true });
  }
}
