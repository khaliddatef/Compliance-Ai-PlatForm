import { Injectable, computed, effect, signal } from '@angular/core';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { ApiService } from './api.service';
import { AuthService, AuthUser } from './auth.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private storageKey = 'compliance-ai-conversations:anon';
  private readonly isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

  readonly conversations = signal<Conversation[]>(this.loadInitialConversations());
  readonly activeConversationId = signal<string>(this.conversations()[0]?.id || '');
  readonly activeConversation = computed(() =>
    this.conversations().find((c) => c.id === this.activeConversationId()),
  );

  constructor(private api: ApiService, private readonly auth: AuthService) {
    this.storageKey = this.buildStorageKey(this.auth.user());
    this.conversations.set(this.loadInitialConversations());
    this.activeConversationId.set(this.conversations()[0]?.id || '');

    effect(() => {
      if (!this.isBrowser) return;
      localStorage.setItem(this.storageKey, JSON.stringify(this.conversations()));
    });

    effect(() => {
      const nextKey = this.buildStorageKey(this.auth.user());
      if (nextKey === this.storageKey) return;
      this.storageKey = nextKey;
      const nextConversations = this.loadInitialConversations();
      this.conversations.set(nextConversations);
      this.activeConversationId.set(nextConversations[0]?.id || '');
    });
  }

  private getPreferredLanguage(): 'ar' | 'en' {
    if (!this.isBrowser || typeof navigator === 'undefined') return 'en';
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }

  private detectLanguage(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text || '') ? 'ar' : 'en';
  }

  startNewConversation() {
    const language = this.getPreferredLanguage();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      backendId: null, // ✅ store backend conversation id per chat
      title: 'New compliance chat',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            language === 'ar'
              ? 'مرحبًا! قولّي تحب تشتغل على إيه (كنترولات، مراجعة أدلة، أو سؤال محدد). وتقدر كمان ترفع ملفات الأدلة.'
              : 'Hi! Tell me what you want to work on (controls, evidence review, or a specific question). You can also upload evidence files.',
          timestamp: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };

    this.conversations.update((list) => [conversation, ...list]);
    this.activeConversationId.set(conversation.id);

    return conversation;
  }

  selectConversation(id: string) {
    if (this.activeConversationId() === id) return;
    const exists = this.conversations().some((c) => c.id === id);
    if (exists) this.activeConversationId.set(id);
  }

  // دي اللي هتستدعيها من الـ component لما تدوس Send
  sendUserMessage(text: string) {
    const convo = this.activeConversation();
    if (!convo) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    this.appendMessage(convo.id, userMsg);

    // typing indicator
    const typingId = crypto.randomUUID();
    this.appendMessage(convo.id, {
      id: typingId,
      role: 'assistant',
      content: '…',
      timestamp: Date.now(),
    });

    const language = this.detectLanguage(text) || this.getPreferredLanguage();
    this.api.sendMessage(text, convo.backendId ?? undefined, language).subscribe({
      next: ({ assistantMessage, conversationId }) => {
        // ✅ save backend conversation id on THIS conversation
        this.conversations.update((list) =>
          list.map((c) =>
            c.id === convo.id ? { ...c, backendId: conversationId } : c,
          ),
        );

        // replace typing with real reply
        this.replaceMessage(convo.id, typingId, {
          id: typingId,
          role: 'assistant',
          content: assistantMessage,
          timestamp: Date.now(),
        });
      },
      error: () => {
        this.replaceMessage(convo.id, typingId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            language === 'ar' ? 'حصلت مشكلة في السيرفر. جرّب مرة تانية.' : 'Server error. Please try again.',
          timestamp: Date.now(),
        });
      },
    });
  }

  appendMessage(conversationId: string, message: Message) {
    this.conversations.update((list) =>
      list
        .map((conversation) => {
          if (conversation.id !== conversationId) return conversation;

          const title =
            conversation.title === 'New compliance chat' && message.role === 'user'
              ? this.deriveTitle(message.content)
              : conversation.title;

          return {
            ...conversation,
            title,
            messages: [...conversation.messages, message],
            updatedAt: Date.now(),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt),
    );
  }

  updateMessage(conversationId: string, messageId: string, update: Partial<Message>) {
    this.conversations.update((list) =>
      list.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((m) => (m.id === messageId ? { ...m, ...update } : m)),
          updatedAt: Date.now(),
        };
      }),
    );
  }

  updateConversation(conversationId: string, update: Partial<Conversation>) {
    this.conversations.update((list) =>
      list.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, ...update, updatedAt: Date.now() } : conversation,
      ),
    );
  }

  clearActions(conversationId: string) {
    this.conversations.update((list) =>
      list.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((m) =>
            m.actions ? { ...m, actions: undefined } : m,
          ),
          updatedAt: Date.now(),
        };
      }),
    );
  }

  private replaceMessage(conversationId: string, oldId: string, nextMsg: Message) {
    this.conversations.update((list) =>
      list.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((m) => (m.id === oldId ? nextMsg : m)),
          updatedAt: Date.now(),
        };
      }),
    );
  }

  // ✅ UI delete + backend delete (if backendId exists)
  removeConversation(id: string) {
    const convo = this.conversations().find((c) => c.id === id);
    const backendId = convo?.backendId ?? null;

    // 1) remove from UI immediately
    this.conversations.update((list) => list.filter((c) => c.id !== id));

    // 2) update active selection if needed
    if (this.activeConversationId() === id) {
      this.activeConversationId.set(this.conversations()[0]?.id || '');
    }

    // 3) call backend delete if we have an id
    if (backendId) {
      this.api.deleteConversation(backendId).subscribe({
        next: () => {},
        error: () => console.warn('Failed to delete conversation on backend'),
      });
    }
  }

  private deriveTitle(content: string) {
    const cleaned = content.trim().slice(0, 40);
    return cleaned.length ? cleaned + (content.length > 40 ? '…' : '') : 'User message';
  }

  private loadInitialConversations(): Conversation[] {
    const language = this.getPreferredLanguage();
    if (this.isBrowser) {
      try {
        const cached = localStorage.getItem(this.storageKey);
        if (cached) {
          const parsed: Conversation[] = JSON.parse(cached);
          if (parsed.length) return parsed;
        }
      } catch (error) {
        console.error('Failed to parse conversations', error);
      }
    }

    const starter: Conversation = {
      id: crypto.randomUUID(),
      backendId: null, // ✅
      title: 'Launch checklist',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            language === 'ar'
              ? 'مرحبًا بك في Tekronyx. قولّي تحب تشتغل على إيه، أو ارفع ملفات للمراجعة السريعة.'
              : 'Welcome to Tekronyx. Tell me what you want to work on, or upload docs for a quick review.',
          timestamp: Date.now() - 1000 * 60 * 5,
        },
      ],
      updatedAt: Date.now(),
    };

    return [starter];
  }

  private buildStorageKey(user: AuthUser | null) {
    const key = user?.id || user?.email || 'anon';
    return `compliance-ai-conversations:${key}`;
  }
}
