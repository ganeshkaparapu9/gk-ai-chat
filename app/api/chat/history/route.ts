// app/api/chat/history/route.ts
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';

const KV_KEY = 'chat:conversations';
const TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days

// Initialize Redis client
const redis = Redis.fromEnv();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sync = searchParams.get('sync') === 'true';

    // Check if Redis is available
    if (!redis) {
      return NextResponse.json(
        { message: 'Redis not available', conversations: [] },
        { status: 200 }
      );
    }

    const conversations = await redis.get(KV_KEY);

    if (!conversations) {
      return NextResponse.json({ conversations: [] });
    }

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    // Gracefully degrade - return empty list instead of error
    return NextResponse.json({ conversations: [] }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const conversations = await request.json();

    // Check if Redis is available
    if (!redis) {
      return NextResponse.json(
        { message: 'Redis not available' },
        { status: 200 }
      );
    }

    // Save to Redis with TTL
    await redis.setex(KV_KEY, TTL_SECONDS, JSON.stringify(conversations));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving conversations:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { conversationId, name } = await request.json();

    // Check if Redis is available
    if (!redis) {
      return NextResponse.json(
        { message: 'Redis not available' },
        { status: 200 }
      );
    }

    const conversations = await redis.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const updated = (conversations as any[]).map(conv =>
      conv.id === conversationId ? { ...conv, name } : conv
    );

    await redis.setex(KV_KEY, TTL_SECONDS, JSON.stringify(updated));

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

    // Check if Redis is available
    if (!redis) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const conversations = await redis.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const filtered = (conversations as any[]).filter(c => c.id !== conversationId);

    await redis.setex(KV_KEY, TTL_SECONDS, JSON.stringify(filtered));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
