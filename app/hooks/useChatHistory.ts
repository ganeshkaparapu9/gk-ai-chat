import { useState, useCallback, useEffect } from 'react';

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize from localStorage
  useEffect(() => {
    const loadFromStorage = async () => {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const activeId = localStorage.getItem(ACTIVE_CONV_KEY);
        
        if (stored) {
          const parsed: Conversation[] = JSON.parse(stored);
          // Filter out expired conversations
          const now = Date.now();
          const valid = parsed.filter(conv => conv.expiresAt > now);
          
          if (valid.length !== parsed.length) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
          }
          
          setConversations(valid);
          
          // Try to load from Vercel KV if deployed
          if (valid.length > 0 && process.env.NEXT_PUBLIC_VERCEL_ENV === 'production') {
            try {
              const syncResponse = await fetch('/api/chat/history?sync=true');
              if (syncResponse.ok) {
                const kvConversations = await syncResponse.json();
                setConversations(kvConversations);
              }
            } catch (err) {
              console.warn('Failed to sync with KV, using localStorage', err);
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
  }, []);

  // Save to localStorage and KV whenever conversations change
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
      
      // Sync to KV if deployed
      if (process.env.NEXT_PUBLIC_VERCEL_ENV === 'production') {
        fetch('/api/chat/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(conversations),
        }).catch(err => console.warn('Failed to sync to KV:', err));
      }
    }
  }, [conversations]);

  // Save active conversation ID to localStorage
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
    return id;
  }, []);

  const getActiveConversation = useCallback((): Conversation | undefined => {
    return conversations.find(c => c.id === activeConversationId);
  }, [conversations, activeConversationId]);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setConversations(prev =>
      prev.map(conv => {
        if (conv.id === activeConversationId) {
          return {
            ...conv,
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
        }
        return conv;
      })
    );
  }, [activeConversationId]);

  const renameConversation = useCallback((conversationId: string, newName: string) => {
    setConversations(prev =>
      prev.map(conv => (conv.id === conversationId ? { ...conv, name: newName } : conv))
    );
  }, []);

  const deleteConversation = useCallback((conversationId: string) => {
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
  }, [activeConversationId, conversations, createNewConversation]);

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
