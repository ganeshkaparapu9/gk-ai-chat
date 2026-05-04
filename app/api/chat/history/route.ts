// app/api/chat/history/route.ts
import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';

const KV_KEY = 'chat:conversations';
const TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sync = searchParams.get('sync') === 'true';

    // Check if KV is available
    if (!kv) {
      return NextResponse.json(
        { message: 'KV not available', conversations: [] },
        { status: 200 }
      );
    }

    const conversations = await kv.get(KV_KEY);
    
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

    // Check if KV is available
    if (!kv) {
      return NextResponse.json(
        { message: 'KV not available' },
        { status: 200 }
      );
    }

    // Save to KV with TTL
    await kv.setex(KV_KEY, TTL_SECONDS, JSON.stringify(conversations));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving conversations:', error);
    // Gracefully degrade - don't fail if KV is unavailable
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { conversationId, name } = await request.json();

    // Check if KV is available
    if (!kv) {
      return NextResponse.json(
        { message: 'KV not available' },
        { status: 200 }
      );
    }

    const conversations = await kv.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const updated = (conversations as any[]).map(conv =>
      conv.id === conversationId ? { ...conv, name } : conv
    );

    await kv.setex(KV_KEY, TTL_SECONDS, JSON.stringify(updated));

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

    // Check if KV is available
    if (!kv) {
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const conversations = await kv.get(KV_KEY);
    if (!conversations) {
      return NextResponse.json({ success: false }, { status: 404 });
    }

    const filtered = (conversations as any[]).filter(c => c.id !== conversationId);

    await kv.setex(KV_KEY, TTL_SECONDS, JSON.stringify(filtered));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ success: true }, { status: 200 });
  }
}
