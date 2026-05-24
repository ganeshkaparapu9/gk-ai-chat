import { useState, useCallback, useEffect, useRef } from 'react';
import { useUser } from '@clerk/nextjs';

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  name: string;
  messages: Message[];
  createdAt: number;
  expiresAt: number;
};

const STORAGE_KEY = 'chatConversations';
const ACTIVE_CONV_KEY = 'activeConversationId';

export function useChatHistory() {
  const { isSignedIn } = useUser();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadFromStorage = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const activeId = localStorage.getItem(ACTIVE_CONV_KEY);

        if (stored) {
          const parsed: Conversation[] = JSON.parse(stored);
          const now = Date.now();
          const valid = parsed.filter(conv => conv.expiresAt > now);

          if (valid.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
          }

          setConversations(valid);

          // Only sync with Redis when signed in
          if (isSignedIn && process.env.NEXT_PUBLIC_VERCEL_ENV === 'production') {
            try {
              const syncResponse = await fetch('/api/chat/history?sync=true');
              if (syncResponse.ok) {
                const data = await syncResponse.json();
                if (Array.isArray(data.conversations) && data.conversations.length > 0) {
                  setConversations(data.conversations);
                  localStorage.setItem(STORAGE_KEY, JSON.stringify(data.conversations));
                }
              }
            } catch (err) {
              console.warn('Failed to sync with Redis, using localStorage', err);
            }
          }
        }

        if (activeId && stored) {
          const parsed: Conversation[] = JSON.parse(stored);
          if (parsed.some(c => c.id === activeId)) {
            setActiveConversationId(activeId);
          } else {
            const newId = createNewConversation();
            setActiveConversationId(newId);
          }
        } else if (stored) {
          const parsed: Conversation[] = JSON.parse(stored);
          if (parsed.length > 0) {
            setActiveConversationId(parsed[0].id);
          } else {
            const newId = createNewConversation();
            setActiveConversationId(newId);
          }
        } else {
          const newId = createNewConversation();
          setActiveConversationId(newId);
        }
      } catch (error) {
        console.error('Error loading chat history:', error);
        const newId = createNewConversation();
        setActiveConversationId(newId);
      } finally {
        setIsLoading(false);
      }
    };

    loadFromStorage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Save to localStorage and optionally sync to Redis (debounced to avoid races)
  useEffect(() => {
    if (conversations.length === 0) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));

    if (!isSignedIn || process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') return;

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      fetch('/api/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversations),
      }).catch(err => console.warn('Failed to sync to Redis:', err));
    }, 500);
  }, [conversations, isSignedIn]);

  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem(ACTIVE_CONV_KEY, activeConversationId);
    }
  }, [activeConversationId]);

  const createNewConversation = useCallback((): string => {
    const id = Date.now().toString();
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const newConv: Conversation = {
      id,
      name: `Chat - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      messages: [],
      createdAt: now,
      expiresAt: now + threeDaysMs,
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(id);
    return id;
  }, []);

  const getActiveConversation = useCallback((): Conversation | undefined => {
    return conversations.find(c => c.id === activeConversationId);
  }, [conversations, activeConversationId]);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setConversations(prev =>
      prev.map(conv => {
        if (conv.id !== activeConversationId) return conv;

        // Auto-name the conversation from the first user message
        const isFirstUserMessage = role === 'user' && conv.messages.length === 0;
        const autoName = isFirstUserMessage
          ? (content.trim().length > 50 ? content.trim().slice(0, 50) + '…' : content.trim())
          : conv.name;

        return {
          ...conv,
          name: autoName,
          messages: [
            ...conv.messages,
            {
              id: Date.now().toString(),
              role,
              content,
              timestamp: Date.now(),
            },
          ],
        };
      })
    );
  }, [activeConversationId]);

  const renameConversation = useCallback((conversationId: string, newName: string) => {
    if (!isSignedIn) return;
    setConversations(prev =>
      prev.map(conv => (conv.id === conversationId ? { ...conv, name: newName } : conv))
    );
  }, [isSignedIn]);

  const deleteConversation = useCallback((conversationId: string) => {
    if (!isSignedIn) return;
    setConversations(prev => prev.filter(c => c.id !== conversationId));
    if (activeConversationId === conversationId) {
      const remaining = conversations.filter(c => c.id !== conversationId);
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
      } else {
        const newId = createNewConversation();
        setActiveConversationId(newId);
      }
    }
  }, [isSignedIn, activeConversationId, conversations, createNewConversation]);

  const switchConversation = useCallback((conversationId: string) => {
    if (conversations.find(c => c.id === conversationId)) {
      setActiveConversationId(conversationId);
    }
  }, [conversations]);

  const clearCurrentConversation = useCallback(() => {
    setConversations(prev =>
      prev.map(conv => (conv.id === activeConversationId ? { ...conv, messages: [] } : conv))
    );
  }, [activeConversationId]);

  return {
    conversations,
    activeConversationId,
    isLoading,
    activeConversation: getActiveConversation(),
    createNewConversation,
    addMessage,
    renameConversation,
    deleteConversation,
    switchConversation,
    clearCurrentConversation,
  };
}
