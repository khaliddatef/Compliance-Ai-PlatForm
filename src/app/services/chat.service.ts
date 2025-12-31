import { Injectable, computed, effect, signal } from '@angular/core';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { ApiService, ComplianceStandard } from './api.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly storageKey = 'compliance-ai-conversations';
  private readonly isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

  readonly conversations = signal<Conversation[]>(this.loadInitialConversations());
  readonly activeConversationId = signal<string>(this.conversations()[0]?.id || '');
  readonly activeConversation = computed(() =>
    this.conversations().find((c) => c.id === this.activeConversationId()),
  );

  constructor(private api: ApiService) {
    effect(() => {
      if (!this.isBrowser) return;
      localStorage.setItem(this.storageKey, JSON.stringify(this.conversations()));
    });
  }

  startNewConversation() {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      backendId: null, // ✅ store backend conversation id per chat
      title: 'New compliance chat',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Hi! Share context or upload docs and I will draft a compliance summary.',
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
  sendUserMessage(text: string, standard: ComplianceStandard) {
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

    this.api.sendMessage(text, standard, convo.backendId ?? undefined).subscribe({
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
          content: 'Server error. Please try again.',
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
            'Welcome to Compliance AI. Ask about audit readiness, summarize risks, or upload docs for a quick review.',
          timestamp: Date.now() - 1000 * 60 * 5,
        },
      ],
      updatedAt: Date.now(),
    };

    return [starter];
  }
}
