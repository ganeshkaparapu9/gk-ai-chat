import { neon } from '@neondatabase/serverless';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

async function isAdmin(userId: string): Promise<boolean> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return (user.publicMetadata as { role?: string })?.role === 'admin';
}

export async function GET() {
  const { userId } = await auth();
  if (!userId || !(await isAdmin(userId))) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const rows = await sql`
      SELECT
        source_id,
        source_name,
        COUNT(*)::int        AS chunk_count,
        MAX(ingested_at)     AS last_ingested_at
      FROM documents
      WHERE source_id IS NOT NULL
      GROUP BY source_id, source_name
      ORDER BY MAX(ingested_at) DESC
    `;

    return Response.json({ documents: rows });
  } catch {
    return Response.json({ error: 'Failed to fetch documents' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId || !(await isAdmin(userId))) {
    return new Response('Forbidden', { status: 403 });
  }

  const sourceId = new URL(req.url).searchParams.get('id');
  if (!sourceId) {
    return Response.json({ error: 'Missing source id' }, { status: 400 });
  }

  try {
    const result = await sql`
      DELETE FROM documents WHERE source_id = ${sourceId}
    `;
    return Response.json({ success: true, deleted: result.length });
  } catch {
    return Response.json({ error: 'Failed to delete document' }, { status: 500 });
  }
}
