'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';

type IngestStatus = 'idle' | 'parsing' | 'ingesting' | 'success' | 'error';

type KBDocument = {
  source_id: string;
  source_name: string;
  chunk_count: number;
  last_ingested_at: string;
};

export default function IngestPage() {
  const { user, isLoaded } = useUser();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [status, setStatus] = useState<IngestStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [chunksInserted, setChunksInserted] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [isDragging, setIsDragging] = useState(false);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const preferredTheme = window.localStorage.getItem('theme');
    if (preferredTheme === 'light' || preferredTheme === 'dark') {
      setTheme(preferredTheme);
    } else {
      setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', theme === 'light');
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
      }
    } catch {
      // non-fatal — list stays empty
    }
  }, []);

  useEffect(() => {
    if (isLoaded && (user?.publicMetadata as { role?: string } | null)?.role === 'admin') {
      fetchDocuments();
    }
  }, [isLoaded, user, fetchDocuments]);

  async function extractTextFromPdf(file: File): Promise<string> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => (item.str ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    }
    return pages.join('\n\n');
  }

  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    // Pre-fill the document name from the file name (strip extension)
    if (!sourceName) {
      setSourceName(file.name.replace(/\.[^/.]+$/, ''));
    }

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      setStatus('parsing');
      setStatusMessage('Extracting text from PDF...');
      try {
        const extracted = await extractTextFromPdf(file);
        if (!extracted.trim()) {
          setStatus('error');
          setStatusMessage('No text could be extracted from this PDF. It may be image-based or scanned.');
          return;
        }
        setText(extracted);
        setStatus('idle');
        setStatusMessage(`Extracted ${extracted.length.toLocaleString()} characters from ${file.name}`);
      } catch (err) {
        setStatus('error');
        setStatusMessage(`Failed to parse PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
      const fileText = await file.text();
      setText(fileText);
      setStatusMessage(`Loaded ${fileText.length.toLocaleString()} characters from ${file.name}`);
    } else {
      setStatus('error');
      setStatusMessage('Unsupported file type. Please upload a PDF or text file.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleIngest() {
    if (!text.trim()) return;

    setStatus('ingesting');
    setStatusMessage('Chunking and generating embeddings...');
    setChunksInserted(0);

    try {
      const response = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), sourceName: sourceName.trim() || undefined }),
      });

      if (!response.ok) {
        if (response.status === 403) throw new Error('Access denied. Make sure your admin role is set and sign out then back in.');
        if (response.status === 401) throw new Error('You must be signed in to ingest documents.');
        if (response.status === 429) throw new Error('Too many requests. Please wait a moment and try again.');
        const errText = await response.text();
        let errMessage = 'Ingest failed';
        try { errMessage = JSON.parse(errText).error || errMessage; } catch { errMessage = errText || errMessage; }
        throw new Error(errMessage);
      }

      const data = await response.json();
      setChunksInserted(data.chunksInserted);
      setStatus('success');
      setStatusMessage(
        `Successfully ingested "${data.sourceName}" — ${data.chunksInserted} chunks stored.`
      );
      fetchDocuments();
    } catch (err) {
      setStatus('error');
      setStatusMessage(`Ingestion failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  async function handleDelete(sourceId: string) {
    if (!confirm('Remove this document from the knowledge base? This cannot be undone.')) return;
    setDeletingId(sourceId);
    try {
      const res = await fetch(`/api/documents?id=${encodeURIComponent(sourceId)}`, { method: 'DELETE' });
      if (res.ok) await fetchDocuments();
    } finally {
      setDeletingId(null);
    }
  }

  function resetForm() {
    setText('');
    setFileName('');
    setSourceName('');
    setStatus('idle');
    setStatusMessage('');
    setChunksInserted(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFile(files[0]);
  }

  const isProcessing = status === 'parsing' || status === 'ingesting';

  if (isLoaded && (user?.publicMetadata as { role?: string } | null)?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground mb-2">Access Denied</p>
          <p className="text-sm text-muted mb-4">You don&apos;t have permission to access this page.</p>
          <Link href="/chat" className="text-sm text-accent hover:underline">Back to chat</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b border-border px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground tracking-tight">Knowledge Base</h1>
              <p className="text-xs text-muted">Upload documents for RAG-powered chat</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Go to Chat
            </Link>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2" /><path d="M12 21v2" />
                  <path d="M4.22 4.22l1.42 1.42" /><path d="M18.36 18.36l1.42 1.42" />
                  <path d="M1 12h2" /><path d="M21 12h2" />
                  <path d="M4.22 19.78l1.42-1.42" /><path d="M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">

        {/* ── Upload Section ── */}
        <section>
          {/* Document name */}
          <div className="mb-5">
            <label htmlFor="source-name" className="block text-sm font-medium text-foreground mb-1.5">
              Document name <span className="text-muted font-normal">(used to replace this document on re-ingest)</span>
            </label>
            <input
              id="source-name"
              type="text"
              value={sourceName}
              onChange={e => setSourceName(e.target.value)}
              placeholder="e.g. My Resume, Company FAQ, Product Docs"
              disabled={isProcessing}
              className="w-full px-4 py-2.5 bg-input-bg border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition disabled:opacity-50"
            />
          </div>

          {/* Drop zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 ${
              isDragging ? 'border-accent bg-accent-muted scale-[1.01]' : 'border-border hover:border-muted'
            } ${isProcessing ? 'pointer-events-none opacity-60' : ''}`}
          >
            <div className="p-8 text-center">
              <div className={`mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-all duration-300 ${isDragging ? 'bg-accent/20 scale-110' : 'bg-surface-2'}`}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-colors ${isDragging ? 'text-accent' : 'text-muted'}`}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <p className="text-foreground font-medium mb-1">{isDragging ? 'Drop your file here' : 'Drag & drop a file here'}</p>
              <p className="text-sm text-muted mb-5">PDF, TXT, or Markdown — or click to browse</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 border border-border text-sm font-medium text-foreground hover:border-accent hover:text-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                Browse Files
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,text/plain,application/pdf"
                className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
              />
            </div>
          </div>

          {/* File badge */}
          {fileName && (
            <div className="mt-4 flex items-center gap-2 animate-message-in">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-2 border border-border text-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-foreground">{fileName}</span>
                <button onClick={resetForm} className="ml-1 text-muted hover:text-foreground transition" title="Remove file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted font-medium uppercase tracking-wider">or paste text</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Text area */}
          <div className="relative">
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              disabled={isProcessing}
              placeholder="Paste or type your document content here..."
              rows={12}
              className="w-full px-5 py-4 bg-input-bg border border-border rounded-2xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all duration-200 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {text && (
              <div className="absolute bottom-4 right-4 px-2.5 py-1 rounded-full bg-surface-2 text-xs text-muted">
                {text.length.toLocaleString()} chars
              </div>
            )}
          </div>

          {/* Status */}
          {statusMessage && (
            <div className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-start gap-3 animate-message-in ${
              status === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-400'
              : status === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
              : 'bg-accent-muted border border-accent/20 text-accent'
            }`}>
              {status === 'error' && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              )}
              {status === 'success' && (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              )}
              {isProcessing && (
                <div className="flex-shrink-0 mt-1">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              <div>
                <p>{statusMessage}</p>
                {status === 'success' && chunksInserted > 0 && (
                  <p className="mt-1 text-xs opacity-80">{chunksInserted} vector embeddings stored in the knowledge base.</p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleIngest}
              disabled={!text.trim() || isProcessing}
              className="flex-1 px-6 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-emerald-500/25 active:scale-[0.98] transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center justify-center gap-2">
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{status === 'parsing' ? 'Parsing...' : 'Ingesting...'}</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span>Ingest into Knowledge Base</span>
                  </>
                )}
              </div>
            </button>
            {(text || status !== 'idle') && (
              <button
                onClick={resetForm}
                disabled={isProcessing}
                className="px-5 py-3.5 rounded-xl border border-border bg-surface text-sm text-foreground hover:border-muted transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            )}
          </div>

          {/* Success CTA */}
          {status === 'success' && (
            <div className="mt-8 p-6 rounded-2xl bg-surface-2 border border-border text-center animate-message-in">
              <div className="w-12 h-12 mx-auto rounded-full bg-accent-muted flex items-center justify-center mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent" strokeLinecap="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h3 className="text-foreground font-semibold mb-1">Knowledge base updated!</h3>
              <p className="text-sm text-muted mb-4">Your documents are now available for RAG-powered chat.</p>
              <Link
                href="/chat"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-accent to-purple-500 text-white font-medium text-sm hover:shadow-lg hover:shadow-accent/25 transition-all"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Start Chatting
              </Link>
            </div>
          )}
        </section>

        {/* ── Ingested Documents ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              Ingested Documents
            </h2>
            <span className="text-xs text-muted">{documents.length} document{documents.length !== 1 ? 's' : ''}</span>
          </div>

          {documents.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
              <p className="text-sm text-muted">No documents ingested yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">Document</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">Chunks</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-muted uppercase tracking-wide">Last ingested</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc, i) => (
                    <tr key={doc.source_id} className={`border-b border-border last:border-0 ${i % 2 === 0 ? '' : 'bg-surface/50'}`}>
                      <td className="px-4 py-3">
                        <p className="text-foreground font-medium">{doc.source_name}</p>
                        <p className="text-xs text-muted">{doc.source_id}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{doc.chunk_count}</td>
                      <td className="px-4 py-3 text-muted">
                        {new Date(doc.last_ingested_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleDelete(doc.source_id)}
                          disabled={deletingId === doc.source_id}
                          className="px-3 py-1 text-xs rounded-lg border border-red-500/40 text-red-500 hover:bg-red-500/10 transition disabled:opacity-50"
                        >
                          {deletingId === doc.source_id ? 'Removing...' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* How it works */}
        <div className="p-5 rounded-2xl bg-surface border border-border">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            How it works
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { n: '1', title: 'Name & Upload', desc: 'Give the doc a name, then paste text or upload a file' },
              { n: '2', title: 'Process', desc: 'Text is chunked & embedded via NVIDIA — old chunks replaced automatically' },
              { n: '3', title: 'Chat', desc: 'AI uses your docs to answer questions with up-to-date context' },
            ].map(step => (
              <div key={step.n} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-accent-muted flex items-center justify-center text-xs font-bold text-accent">{step.n}</div>
                <div>
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                  <p className="text-xs text-muted">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
