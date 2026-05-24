import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = neon(process.env.DATABASE_URL);

// Run once per server process (cold start), not on every request.
// Subsequent calls reuse the resolved promise — no extra DB round trips.
let migrationPromise: Promise<void> | null = null;

function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
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
      // Unique index: enforces one row per (user, conversation) and speeds up upserts
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS chat_history_user_conv_idx
          ON chat_history(user_id, conversation_id)
      `;
      // Covering index: makes the ORDER BY updated_at DESC in GET a fast index scan
      await sql`
        CREATE INDEX IF NOT EXISTS chat_history_user_updated_idx
          ON chat_history(user_id, updated_at DESC)
      `;
    })();
  }
  return migrationPromise;
}

// GET — purge conversations older than 5 days, then return the rest for this user
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    await ensureMigrated();

    // Cleanup: any conversation not touched in the last 5 days is removed
    await sql`
      DELETE FROM chat_history
      WHERE user_id = ${userId}
        AND updated_at < NOW() - INTERVAL '5 days'
    `;

    const rows = await sql`
      SELECT conversation_id, name, messages, created_at, updated_at
      FROM   chat_history
      WHERE  user_id = ${userId}
      ORDER  BY updated_at DESC
    `;

    // Map DB snake_case columns → TypeScript camelCase Conversation shape
    const conversations = rows.map(row => ({
      id:        row.conversation_id as string,
      name:      row.name            as string,
      messages:  row.messages        as object[],
      createdAt: new Date(row.created_at as string).getTime(),
      // expiresAt mirrors the server rule so the client cache stays consistent
      expiresAt: new Date(row.updated_at as string).getTime() + 5 * 24 * 60 * 60 * 1000,
    }));

    return NextResponse.json({ conversations });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return NextResponse.json({ conversations: [] });
  }
}

// POST — upsert all conversations for this user (sent as a debounced batch from the hook)
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const body = await request.json();
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be an array of conversations' }, { status: 400 });
    }

    await ensureMigrated();

    // Upsert each conversation; only rows that actually changed get a new updated_at
    for (const conversation of body) {
      if (!conversation.id || typeof conversation.id !== 'string') continue;

      const conversationName     = typeof conversation.name === 'string' ? conversation.name : 'New Chat';
      const conversationMessages = Array.isArray(conversation.messages) ? conversation.messages : [];

      await sql`
        INSERT INTO chat_history (user_id, conversation_id, name, messages)
        VALUES (
          ${userId},
          ${conversation.id},
          ${conversationName},
          ${JSON.stringify(conversationMessages)}
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

// DELETE — remove a single conversation immediately (called directly from deleteConversation)
export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const conversationId = new URL(request.url).searchParams.get('id');
    if (!conversationId || typeof conversationId !== 'string' || conversationId.trim() === '') {
      return NextResponse.json({ error: 'Missing or invalid conversation id' }, { status: 400 });
    }

    // RETURNING lets us detect whether a row was actually deleted
    const deleted = await sql`
      DELETE FROM chat_history
      WHERE user_id        = ${userId}
        AND conversation_id = ${conversationId}
      RETURNING conversation_id
    `;

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });
  }
}
