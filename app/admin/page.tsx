'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/nextjs';
import { redirect } from 'next/navigation';
import Link from 'next/link';

type UserRecord = {
  id: string;
  email: string;
  createdAt: number;
};

type UserListResponse = {
  users: UserRecord[];
  totalCount: number;
  maxUsers: number;
};

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const [data, setData] = useState<UserListResponse | null>(null);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isAdmin = isLoaded && (user?.publicMetadata as { role?: string } | null)?.role === 'admin';

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to fetch users');
      setData(await res.json());
    } catch {
      setError('Could not load users.');
    }
  }, []);

  useEffect(() => {
    if (isLoaded && !isAdmin) redirect('/chat');
    if (isAdmin) fetchUsers();
  }, [isLoaded, isAdmin, fetchUsers]);

  async function deleteUser(id: string) {
    if (!confirm('Remove this user? They will no longer be able to sign in.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/users?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      await fetchUsers();
    } catch {
      setError('Failed to delete user.');
    } finally {
      setDeletingId(null);
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted text-sm">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground tracking-tight">User Management</h1>
              <p className="text-xs text-muted">Admin panel</p>
            </div>
          </div>
          <Link
            href="/chat"
            className="text-sm text-muted hover:text-foreground transition"
          >
            ← Back to chat
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="mb-6 flex items-center gap-4">
              <div className="px-4 py-3 rounded-lg bg-surface border border-border">
                <p className="text-xs text-muted mb-1">Total users</p>
                <p className="text-2xl font-bold text-foreground">{data.totalCount}</p>
              </div>
              <div className="px-4 py-3 rounded-lg bg-surface border border-border">
                <p className="text-xs text-muted mb-1">User cap</p>
                <p className="text-2xl font-bold text-foreground">{data.maxUsers}</p>
              </div>
              <div className={`px-4 py-3 rounded-lg border ${data.totalCount >= data.maxUsers ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                <p className="text-xs text-muted mb-1">Capacity</p>
                <p className={`text-2xl font-bold ${data.totalCount >= data.maxUsers ? 'text-red-500' : 'text-emerald-500'}`}>
                  {data.totalCount >= data.maxUsers ? 'Full' : 'Open'}
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">Email</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">Joined</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u, i) => (
                    <tr key={u.id} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-surface/50'}`}>
                      <td className="px-4 py-3 text-foreground">
                        {u.email}
                        {u.id === user?.id && (
                          <span className="ml-2 text-xs text-accent font-medium">(you)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {u.id !== user?.id && (
                          <button
                            onClick={() => deleteUser(u.id)}
                            disabled={deletingId === u.id}
                            className="px-3 py-1 text-xs rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 transition disabled:opacity-50"
                          >
                            {deletingId === u.id ? 'Removing...' : 'Remove'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
