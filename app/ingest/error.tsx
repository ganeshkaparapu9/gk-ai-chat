'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function IngestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Ingest page error:', error);
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p className="text-foreground font-semibold">Something went wrong</p>
        <p className="text-muted text-sm">{error.message || 'An unexpected error occurred on the ingest page.'}</p>
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition"
          >
            Try again
          </button>
          <Link
            href="/chat"
            className="px-4 py-2 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-surface transition"
          >
            Back to chat
          </Link>
        </div>
      </div>
    </div>
  );
}
