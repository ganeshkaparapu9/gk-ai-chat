// app/page.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { UserButton, useUser } from '@clerk/nextjs';
import { useChatHistory, type Conversation } from '@/app/hooks/useChatHistory';

function ThinkingIndicator() {
  return (
    <div className="flex justify-start animate-message-in">
      <div className="flex items-start gap-3 max-w-[80%]">
        {/* Avatar */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center mt-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
            <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
            <path d="M12 12v8" />
            <path d="M8 16h8" />
            <circle cx="12" cy="22" r="1" />
          </svg>
        </div>
        {/* Bubble */}
        <div className="rounded-2xl rounded-tl-sm px-5 py-4 bg-surface-2 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-accent">AI Assistant</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-muted mr-1">Thinking</span>
            <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent inline-block"></span>
            <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent inline-block"></span>
            <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-accent inline-block"></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onCreateNew,
  onDeleteConversation,
  onRenameConversation,
}: {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onCreateNew: () => void;
  onDeleteConversation: (id: string) => void;
  onRenameConversation: (id: string, newName: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const startEditing = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditingName(conv.name);
  };

  const saveEdit = (id: string) => {
    if (editingName.trim()) {
      onRenameConversation(id, editingName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="w-64 bg-surface border-r border-border flex flex-col overflow-hidden">
      {/* New Chat Button */}
      <div className="p-4 border-b border-border">
        <button
          onClick={onCreateNew}
          className="w-full px-4 py-2 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent/90 transition"
        >
          + New Chat
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="p-4 text-center text-muted text-sm">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`group relative rounded-lg transition ${
                  conv.id === activeConversationId
                    ? 'bg-accent/20 border border-accent/30'
                    : 'border border-transparent hover:bg-surface-2'
                }`}
              >
                {editingId === conv.id ? (
                  <div className="flex items-center gap-2 p-2">
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit(conv.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => saveEdit(conv.id)}
                      className="flex-1 px-2 py-1 text-sm bg-input-bg border border-border rounded outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                ) : (
                  <div
                    onClick={() => onSelectConversation(conv.id)}
                    className="w-full text-left px-3 py-2 flex items-center gap-2 group/btn cursor-pointer"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="flex-shrink-0 text-accent">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{conv.name}</p>
                      <p className="text-xs text-muted">
                        {conv.messages.length} message{conv.messages.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          startEditing(conv);
                        }}
                        className="p-1 hover:bg-surface-2 rounded transition"
                        title="Rename"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onDeleteConversation(conv.id);
                        }}
                        className="p-1 hover:bg-red-500/20 rounded transition text-red-500"
                        title="Delete"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { user } = useUser();
  const isAdmin = (user?.publicMetadata as { role?: string } | null)?.role === 'admin';
  const chatHistory = useChatHistory();
  const { conversations, activeConversation, isLoading, activeConversationId } = chatHistory;
  const [input, setInput] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isLoading_old = isStreaming;
  const isThinking = isStreaming;

  const statusMessage = isStreaming
    ? 'Receiving response from Llama 3.1...'
    : 'Ready to chat';

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages, streamingResponse, isStreaming]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming || !activeConversation) return;

    const userMessage = input;
    setInput('');
    
    // Add user message to history
    chatHistory.addMessage('user', userMessage);

    setIsStreaming(true);
    setStreamingResponse('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            ...activeConversation.messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
            {
              role: 'user',
              content: userMessage,
            },
          ],
        }),
      });

      if (!response.ok) {
        if (response.status === 429) throw new Error('Too many requests — please wait a moment.');
        const errText = await response.text();
        let errMsg = 'Failed to get response';
        try { errMsg = JSON.parse(errText).error || errMsg; } catch { errMsg = errText || errMsg; }
        throw new Error(errMsg);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        setStreamingResponse(fullResponse);
      }

      // Add AI response to history
      chatHistory.addMessage('assistant', fullResponse);
      setStreamingResponse('');
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
      chatHistory.addMessage('assistant', errorMessage);
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar — only for signed-in users */}
      {!isLoading && user && (
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={chatHistory.switchConversation}
          onCreateNew={chatHistory.createNewConversation}
          onDeleteConversation={chatHistory.deleteConversation}
          onRenameConversation={chatHistory.renameConversation}
        />
      )}

      {/* Main Chat Area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-10 backdrop-blur-xl bg-background/80 border-b border-border px-6 py-4">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center shadow-lg shadow-accent/20">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground tracking-tight">
                  {activeConversation?.name || 'AI Chat'}
                </h1>
                <p className="text-xs text-muted">Powered by Llama 3.1</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isStreaming ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-muted">
                  <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                  <span className="text-xs font-medium text-accent">Receiving response...</span>
                </div>
              ) : (
                <div className="px-3 py-1.5 rounded-full bg-surface text-xs text-muted">{statusMessage}</div>
              )}
              {isAdmin && (
                <Link
                  href="/ingest"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-surface text-xs font-medium text-foreground hover:border-emerald-500 hover:text-emerald-500 transition"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                  Knowledge Base
                </Link>
              )}
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface px-3 py-2 text-sm text-foreground transition hover:border-accent hover:text-accent"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2" />
                    <path d="M12 21v2" />
                    <path d="M4.22 4.22l1.42 1.42" />
                    <path d="M18.36 18.36l1.42 1.42" />
                    <path d="M1 12h2" />
                    <path d="M21 12h2" />
                    <path d="M4.22 19.78l1.42-1.42" />
                    <path d="M18.36 5.64l1.42-1.42" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                  </svg>
                )}
              </button>
              <UserButton />
            </div>
          </div>
        </header>

        {/* Messages Area */}
        <main className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-4xl mx-auto space-y-5">
            {/* Empty state */}
            {(!activeConversation || activeConversation.messages.length === 0) && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-purple-500 flex items-center justify-center mb-6 shadow-xl shadow-accent/20">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-foreground mb-2">How can I help you?</h2>
                <p className="text-sm text-muted max-w-sm">Ask me anything — I&apos;m powered by Llama 3.1 and ready to assist.</p>
              </div>
            )}

            {/* Messages */}
            {activeConversation?.messages.map(m => (
              <div
                key={m.id}
                className={`flex animate-message-in ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {m.role === 'user' ? (
                  /* User message */
                  <div className="max-w-[75%] rounded-2xl rounded-tr-sm px-5 py-3.5 text-white shadow-lg shadow-accent/10"
                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                  >
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  /* AI message */
                  <div className="flex items-start gap-3 max-w-[80%]">
                    {/* Avatar */}
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center mt-1">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                        <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                        <path d="M12 12v8" />
                        <path d="M8 16h8" />
                        <circle cx="12" cy="22" r="1" />
                      </svg>
                    </div>
                    {/* Bubble */}
                    <div className="rounded-2xl rounded-tl-sm px-5 py-4 bg-surface-2 border border-border">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-accent">AI Assistant</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                        {m.content}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Streaming response */}
            {isStreaming && streamingResponse && (
              <div className="flex items-start gap-3 max-w-[80%]">
                {/* Avatar */}
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-muted flex items-center justify-center mt-1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                    <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z" />
                    <path d="M12 12v8" />
                    <path d="M8 16h8" />
                    <circle cx="12" cy="22" r="1" />
                  </svg>
                </div>
                {/* Bubble */}
                <div className="rounded-2xl rounded-tl-sm px-5 py-4 bg-surface-2 border border-border">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-accent">AI Assistant</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {streamingResponse}
                    <span className="inline-block w-1.5 h-5 ml-0.5 bg-accent/50 animate-pulse"></span>
                  </div>
                </div>
              </div>
            )}

            {/* Thinking indicator */}
            {isStreaming && !streamingResponse && <ThinkingIndicator />}

            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Sign-in nudge for guests */}
        {!user && (
          <div className="text-center py-2 text-xs text-muted border-t border-border bg-background/60">
            <Link href="/sign-in" className="text-accent hover:underline">Sign in</Link>
            {' '}to save your chat history across sessions
          </div>
        )}

        {/* Input Area */}
        <footer className="sticky bottom-0 bg-background/80 backdrop-blur-xl border-t border-border px-4 py-4">
          <form onSubmit={handleSubmit} className="max-w-4xl mx-auto flex items-center gap-3">
            <div className="flex-1 relative">
              <input
                id="chat-input"
                className="w-full px-5 py-3.5 bg-input-bg border border-border rounded-xl text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all duration-200"
                value={input}
                placeholder="Type your message..."
                onChange={(e) => setInput(e.target.value)}
                disabled={isStreaming || isLoading}
                autoComplete="off"
              />
            </div>
            <button
              id="send-button"
              type="submit"
              disabled={isStreaming || isLoading || !input.trim()}
              className="flex-shrink-0 px-5 py-3.5 bg-gradient-to-r from-accent to-purple-500 text-white rounded-xl font-medium text-sm disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-accent/25 active:scale-[0.97] transition-all duration-200 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <span>Send</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </div>
            </button>
          </form>
        </footer>
      </div>
    </div>
  );
}