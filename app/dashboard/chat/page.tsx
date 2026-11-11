'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Send, Sparkles, Plus, MessageSquare, Trash2, Bot, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: {
    products?: Array<{
      id: string;
      name: string;
      slug: string;
      brand: string | null;
      imageUrl: string | null;
      price: number | null;
    }>;
    comparison?: string;
    budget?: number;
  } | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

const SUGGESTED_PROMPTS = [
  'Best gaming laptop under $1000',
  'Compare iPhone vs Samsung Galaxy',
  'What are today\'s best deals?',
  'Best camera for YouTube under $500',
];

export default function ChatPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/chat/conversations');
      const data = await res.json();
      if (data.success) {
        const convs = (data.data ?? []) as Conversation[];
        setConversations(convs);
        if (convs.length > 0 && !activeConversationId) {
          setActiveConversationId(convs[0].id);
        }
      }
    } catch {
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [activeConversationId]);

  const fetchMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/v1/chat/messages?conversationId=${conversationId}`);
      const data = await res.json();
      if (data.success) {
        setMessages(data.data ?? []);
      }
    } catch {
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createNewConversation = async () => {
    try {
      const res = await fetch('/api/v1/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' }),
      });
      const data = await res.json();
      if (data.success) {
        const newConv = data.data as Conversation;
        setConversations([newConv, ...conversations]);
        setActiveConversationId(newConv.id);
        setMessages([]);
      }
    } catch {
      // Error creating conversation
    }
  };

  const sendMessage = async (messageText?: string) => {
    const text = messageText ?? input;
    if (!text.trim() || loading) return;

    let conversationId = activeConversationId;

    if (!conversationId) {
      try {
        const res = await fetch('/api/v1/chat/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 50) }),
        });
        const data = await res.json();
        if (data.success) {
          const newConv = data.data as Conversation;
          conversationId = newConv.id;
          setConversations([newConv, ...conversations]);
          setActiveConversationId(newConv.id);
        } else {
          return;
        }
      } catch {
        return;
      }
    }

    const userMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversationId: conversationId!,
      role: 'user',
      content: text,
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/v1/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = await res.json();
      if (data.success) {
        const aiMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          conversationId: conversationId!,
          role: 'assistant',
          content: data.data.response,
          metadata: data.data.metadata,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      } else {
        // A non-success API response used to leave the user's message
        // hanging with no reply at all. Show the same honest failure
        // note as the network-error path below.
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            conversationId: conversationId!,
            role: 'assistant',
            content: 'Sorry, I had trouble processing your request. Please try again.',
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        conversationId: conversationId!,
        role: 'assistant',
        content: 'Sorry, I had trouble processing your request. Please try again.',
        metadata: null,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-0">
      {/* Sidebar */}
      <div className="hidden w-64 flex-col border-r border-slate-200 bg-muted/50 dark:border-slate-800 dark:bg-card md:flex">
        <div className="p-3">
          <Button onClick={createNewConversation} className="w-full" variant="outline">
            <Plus className="mr-2 h-4 w-4" /> New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {loadingConversations ? (
            <div className="flex justify-center py-4"><LoadingSpinner size="sm" /></div>
          ) : conversations.length > 0 ? (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <Button
                  key={conv.id}
                  type="button"
                  variant="ghost"
                  onClick={() => setActiveConversationId(conv.id)}
                  className={cn(
                    'h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-left text-sm font-normal',
                    activeConversationId === conv.id
                      ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0" />
                  <span className="truncate">{conv.title}</span>
                </Button>
              ))}
            </div>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">No conversations yet</p>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col">
        {/* Mobile only: the conversation sidebar (with New Chat) is
            hidden below md, so without this a mobile visitor could
            never start a fresh conversation — only continue the
            auto-selected one. */}
        <div className="border-b border-slate-200 p-3 dark:border-slate-800 md:hidden">
          <Button onClick={createNewConversation} className="w-full" variant="outline" size="sm">
            <Plus className="mr-2 h-4 w-4" /> New Chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500">
                  <Sparkles className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-xl font-bold">AI Shopping Assistant</h2>
                <p className="mt-1 text-muted-foreground">Ask me about products, deals, comparisons, or budget recommendations</p>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <Button
                      key={prompt}
                      type="button"
                      variant="outline"
                      onClick={() => sendMessage(prompt)}
                      className="h-auto w-full justify-start whitespace-normal rounded-lg px-4 py-3 text-left text-sm font-normal hover:border-blue-300 hover:shadow-sm"
                    >
                      {prompt}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  'flex gap-3',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {msg.role === 'assistant' && (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-4 py-3',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  )}
                >
                  <p className="whitespace-pre-line text-sm">{msg.content}</p>
                  {msg.metadata?.products && msg.metadata.products.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {msg.metadata.products.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          variant="outline"
                          onClick={() => router.push(`/products/${p.slug}`)}
                          className="h-auto w-full justify-start gap-2 whitespace-normal rounded-lg p-2 text-left font-normal hover:border-blue-300"
                        >
                          {p.imageUrl && (
                            <Image src={p.imageUrl} alt={p.name} width={40} height={40} className="h-10 w-10 rounded object-cover" />
                          )}
                          <div className="flex-1 overflow-hidden">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            {p.brand && <p className="text-xs text-muted-foreground">{p.brand}</p>}
                          </div>
                          {p.price && (
                            <span className="text-sm font-bold text-green-600">${p.price.toFixed(2)}</span>
                          )}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted dark:bg-accent">
                    <User className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-500">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl bg-muted px-4 py-3 dark:bg-muted">
                  <LoadingSpinner size="sm" />
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="mx-auto flex max-w-3xl gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about products, deals, comparisons..."
              disabled={loading}
              autoFocus
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? <LoadingSpinner size="sm" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
