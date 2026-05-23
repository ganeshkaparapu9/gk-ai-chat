import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest } from 'next/server';

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

  const client = await clerkClient();
  const { data: users, totalCount } = await client.users.getUserList({ limit: 100, orderBy: '-created_at' });

  const maxUsers = parseInt(process.env.MAX_USERS ?? '20', 10);

  return Response.json({
    users: users.map(u => ({
      id: u.id,
      email: u.emailAddresses[0]?.emailAddress ?? '',
      createdAt: u.createdAt,
    })),
    totalCount,
    maxUsers,
  });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId || !(await isAdmin(userId))) {
    return new Response('Forbidden', { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const targetId = searchParams.get('id');

  if (!targetId) {
    return Response.json({ error: 'Missing user ID' }, { status: 400 });
  }

  if (targetId === userId) {
    return Response.json({ error: 'Cannot delete your own account from here' }, { status: 400 });
  }

  const client = await clerkClient();
  await client.users.deleteUser(targetId);
  return Response.json({ success: true });
}
