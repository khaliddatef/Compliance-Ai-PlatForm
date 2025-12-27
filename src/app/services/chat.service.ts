import { Injectable, computed, effect, signal } from '@angular/core';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import { ApiService, ComplianceStandard } from './api.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly storageKey = 'compliance-ai-conversations';
  private readonly hasBrowserStorage = typeof localStorage !== 'undefined';

  // مهم: ده ID الحقيقي اللي بيرجعه الباك لكل محادثة
  private readonly backendConversationId = signal<string | null>(null);

  readonly conversations = signal<Conversation[]>(this.loadInitialConversations());
  readonly activeConversationId = signal<string>(this.conversations()[0]?.id || '');
  readonly activeConversation = computed(() =>
    this.conversations().find((c) => c.id === this.activeConversationId())
  );

  constructor(private api: ApiService) {
    effect(() => {
      if (!this.hasBrowserStorage) return;
      localStorage.setItem(this.storageKey, JSON.stringify(this.conversations()));
    });
  }

  startNewConversation() {
    const conversation: Conversation = {
      id: crypto.randomUUID(),
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

    // reset backend conversation id for a fresh thread
    this.backendConversationId.set(null);

    return conversation;
  }

  selectConversation(id: string) {
    if (this.activeConversationId() === id) return;
    const exists = this.conversations().some((c) => c.id === id);
    if (exists) {
      this.activeConversationId.set(id);
      // اختيار محادثة قديمة = نبدأ thread جديدة في الباك (ممكن نطورها بعدين)
      this.backendConversationId.set(null);
    }
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

    this.api
      .sendMessage(text, standard, this.backendConversationId() ?? undefined)
      .subscribe({
        next: ({ assistantMessage, conversationId }) => {
          // update backend conversation id (so next message continues same thread)
          this.backendConversationId.set(conversationId);

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
        .sort((a, b) => b.updatedAt - a.updatedAt)
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
      })
    );
  }

  removeConversation(id: string) {
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.activeConversationId() === id) {
      this.activeConversationId.set(this.conversations()[0]?.id || '');
      this.backendConversationId.set(null);
    }
  }

  private deriveTitle(content: string) {
    const cleaned = content.trim().slice(0, 40);
    return cleaned.length ? cleaned + (content.length > 40 ? '…' : '') : 'User message';
  }

  private loadInitialConversations() {
    if (this.hasBrowserStorage) {
      const cached = localStorage.getItem(this.storageKey);
      if (cached) {
        try {
          const parsed: Conversation[] = JSON.parse(cached);
          if (parsed.length) return parsed;
        } catch (error) {
          console.error('Failed to parse conversations', error);
        }
      }
    }

    const starter: Conversation = {
      id: crypto.randomUUID(),
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
