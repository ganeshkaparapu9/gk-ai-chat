// app/api/chat/history/route.ts
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

const KV_KEY = 'chat:conversations';
const TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days

// Initialize Redis lazily to ensure env vars are available
let redis: Redis | null = null;

function getRedisClient(): Redis | null {
  if (redis) return redis;

  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;

    if (!url || !token) {
      console.warn(
        'Redis not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN'
      );
      return null;
    }

    redis = new Redis({
      url,
      token,
    });
    return redis;
  } catch (error) {
    console.error('Failed to initialize Redis:', error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json(
        { message: 'Redis not configured', conversations: [] },
        { status: 200 }
      );
    }

    const conversations = await redisClient.get(KV_KEY);

    if (!conversations) {
      return NextResponse.json({ conversations: [] });
    }

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ conversations: [] }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const conversations = await request.json();

    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json(
        { message: 'Redis not configured', success: true },
        { status: 200 }
      );
    }

    await redisClient.setex(KV_KEY, TTL_SECONDS, JSON.stringify(conversations));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving conversations:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { conversationId, name } = await request.json();

    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json(
        { message: 'Redis not configured' },
        { status: 200 }
      );
    }

    const conversations = await redisClient.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const updated = (conversations as any[]).map(conv =>
      conv.id === conversationId ? { ...conv, name } : conv
    );

    await redisClient.setex(KV_KEY, TTL_SECONDS, JSON.stringify(updated));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating conversation:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('id');

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Missing conversation ID' },
        { status: 400 }
      );
    }

    const redisClient = getRedisClient();

    if (!redisClient) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const conversations = await redisClient.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const filtered = (conversations as any[]).filter(c => c.id !== conversationId);

    await redisClient.setex(KV_KEY, TTL_SECONDS, JSON.stringify(filtered));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
