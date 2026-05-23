import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { clerkClient } from '@clerk/nextjs/server';

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('CLERK_WEBHOOK_SECRET is not set');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  const headerPayload = await headers();
  const svixId = headerPayload.get('svix-id');
  const svixTimestamp = headerPayload.get('svix-timestamp');
  const svixSignature = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const payload = await req.text();

  const wh = new Webhook(webhookSecret);
  let event: { type: string; data: { id: string } };

  try {
    event = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as typeof event;
  } catch {
    return new Response('Invalid webhook signature', { status: 400 });
  }

  if (event.type === 'user.created') {
    const maxUsers = parseInt(process.env.MAX_USERS ?? '20', 10);
    const client = await clerkClient();
    const { totalCount } = await client.users.getUserList({ limit: 1 });

    if (totalCount > maxUsers) {
      await client.users.deleteUser(event.data.id);
      console.warn(`User ${event.data.id} removed: user cap of ${maxUsers} reached`);
    }
  }

  return new Response('OK', { status: 200 });
}
