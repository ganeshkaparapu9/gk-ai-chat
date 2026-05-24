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

// Storage keys are scoped per user so different accounts never share data
function storageKey(userId: string | null) {
  return userId ? `chatConversations_${userId}` : 'chatConversations_guest';
}

function activeConvKey(userId: string | null) {
  return userId ? `activeConversationId_${userId}` : 'activeConversationId_guest';
}

function makeNewConversation(): Conversation {
  const now = Date.now();
  return {
    id: now.toString(),
    name: `Chat - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
    messages: [],
    createdAt: now,
    expiresAt: now + 5 * 24 * 60 * 60 * 1000,
  };
}

export function useChatHistory() {
  const { isSignedIn, user } = useUser();
  const userId = user?.id ?? null;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reload everything whenever the logged-in user changes (login, logout, user switch)
  useEffect(() => {
    // Reset immediately so no previous user's data is ever visible
    setConversations([]);
    setActiveConversationId(null);
    setIsLoading(true);

    const STORAGE_KEY = storageKey(userId);
    const ACTIVE_KEY = activeConvKey(userId);

    const loadFromStorage = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const activeId = localStorage.getItem(ACTIVE_KEY);

        // Render from localStorage cache immediately for fast paint
        let valid: Conversation[] = [];
        if (stored) {
          const parsed: Conversation[] = JSON.parse(stored);
          const now = Date.now();
          valid = parsed.filter(conv => conv.expiresAt > now);
          if (valid.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
          }
          setConversations(valid);
        }

        // Signed-in users: fetch from DB (triggers 5-day cleanup server-side)
        if (isSignedIn && userId) {
          try {
            const res = await fetch('/api/chat/history');
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.conversations) && data.conversations.length > 0) {
                valid = data.conversations as Conversation[];
                setConversations(valid);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
              }
            }
          } catch (err) {
            console.warn('Failed to load from DB, using localStorage cache:', err);
          }
        }

        // Restore active conversation
        if (valid.length > 0) {
          const restoredId =
            activeId && valid.some(c => c.id === activeId) ? activeId : valid[0].id;
          setActiveConversationId(restoredId);
        } else {
          // No conversations for this user — start fresh
          const newConv = makeNewConversation();
          setConversations([newConv]);
          setActiveConversationId(newConv.id);
        }
      } catch (error) {
        console.error('Error loading chat history:', error);
        const newConv = makeNewConversation();
        setConversations([newConv]);
        setActiveConversationId(newConv.id);
      } finally {
        setIsLoading(false);
      }
    };

    loadFromStorage();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Persist to localStorage + debounced DB sync on every change
  useEffect(() => {
    if (isLoading) return;
    if (conversations.length === 0) return;

    localStorage.setItem(storageKey(userId), JSON.stringify(conversations));

    // Sync to DB for signed-in users (works in dev and production)
    if (!isSignedIn || !userId) return;

    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      fetch('/api/chat/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversations),
      }).catch(err => console.warn('Failed to sync to DB:', err));
    }, 500);
  }, [conversations, isSignedIn, userId, isLoading]);

  // Persist active conversation id (user-scoped)
  useEffect(() => {
    if (activeConversationId) {
      localStorage.setItem(activeConvKey(userId), activeConversationId);
    }
  }, [activeConversationId, userId]);

  const createNewConversation = useCallback((): string => {
    const newConv = makeNewConversation();
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    return newConv.id;
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
          // Bump expiresAt so active conversations stay alive another 5 days
          expiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
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
    setConversations(prev =>
      prev.map(conv => (conv.id === conversationId ? { ...conv, name: newName } : conv))
    );
  }, []);

  const deleteConversation = useCallback((conversationId: string) => {
    if (!isSignedIn) return;

    setConversations(prev => prev.filter(c => c.id !== conversationId));

    if (activeConversationId === conversationId) {
      const remaining = conversations.filter(c => c.id !== conversationId);
      if (remaining.length > 0) {
        setActiveConversationId(remaining[0].id);
      } else {
        const newConv = makeNewConversation();
        setConversations([newConv]);
        setActiveConversationId(newConv.id);
      }
    }

    // Remove from DB immediately (don't wait for the debounced POST)
    fetch(`/api/chat/history?id=${conversationId}`, { method: 'DELETE' }).catch(err =>
      console.warn('Failed to delete conversation from DB:', err)
    );
  }, [isSignedIn, activeConversationId, conversations]);

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
