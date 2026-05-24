import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const sql = neon(process.env.DATABASE_URL!);

async function migrate() {
  await sql`
    CREATE TABLE IF NOT EXISTS chat_history (
      id              SERIAL PRIMARY KEY,
      user_id         TEXT        NOT NULL,
      conversation_id TEXT        NOT NULL,
      name            TEXT        NOT NULL DEFAULT 'New Chat',
      messages        JSONB       NOT NULL DEFAULT '[]',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_history_user_conv_idx
      ON chat_history(user_id, conversation_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS chat_history_user_updated_idx
      ON chat_history(user_id, updated_at DESC)
  `;
}

// GET — purge data older than 5 days, then return this user's conversations
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    await migrate();

    // Cleanup: remove conversations not touched in the last 5 days
    await sql`
      DELETE FROM chat_history
      WHERE user_id = ${userId}
        AND updated_at < NOW() - INTERVAL '5 days'
    `;

    const rows = await sql`
      SELECT conversation_id, name, messages, created_at, updated_at
      FROM chat_history
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
    `;

    // Re-shape rows back into the Conversation objects the hook expects
    const conversations = rows.map(row => ({
      id: row.conversation_id as string,
      name: row.name as string,
      messages: row.messages as object[],
      createdAt: new Date(row.created_at as string).getTime(),
      // expiresAt mirrors the server rule: updated_at + 5 days
      expiresAt: new Date(row.updated_at as string).getTime() + 5 * 24 * 60 * 60 * 1000,
    }));

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return NextResponse.json({ conversations: [] });
  }
}

// POST — upsert all conversations for this user (debounced batch from the hook)
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const conversations = await request.json();
    if (!Array.isArray(conversations)) {
      return NextResponse.json({ error: 'Expected an array' }, { status: 400 });
    }

    await migrate();

    for (const conv of conversations) {
      if (!conv.id || typeof conv.id !== 'string') continue;
      await sql`
        INSERT INTO chat_history (user_id, conversation_id, name, messages)
        VALUES (
          ${userId},
          ${conv.id},
          ${conv.name ?? 'New Chat'},
          ${JSON.stringify(conv.messages ?? [])}
        )
        ON CONFLICT (user_id, conversation_id) DO UPDATE
          SET name       = EXCLUDED.name,
              messages   = EXCLUDED.messages,
              updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving chat history:', error);
    return NextResponse.json({ success: true });
  }
}

// DELETE — remove a single conversation by id
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const conversationId = new URL(request.url).searchParams.get('id');
    if (!conversationId) {
      return NextResponse.json({ error: 'Missing conversation id' }, { status: 400 });
    }

    await sql`
      DELETE FROM chat_history
      WHERE user_id       = ${userId}
        AND conversation_id = ${conversationId}
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ success: true });
  }
}
