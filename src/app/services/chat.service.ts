import { Injectable, computed, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Conversation } from '../models/conversation.model';
import { Message } from '../models/message.model';
import {
  ApiService,
  ChatConversationSummary,
  ChatMessageRecord,
  UploadDocumentRecord,
} from './api.service';

@Injectable({ providedIn: 'root' })
export class ChatService {
  readonly conversations = signal<Conversation[]>(this.loadInitialConversations());
  readonly activeConversationId = signal<string>(this.conversations()[0]?.id || '');
  readonly activeConversation = computed(() =>
    this.conversations().find((c) => c.id === this.activeConversationId()),
  );

  constructor(private api: ApiService) {}

  resetForUser() {
    const fresh = this.loadInitialConversations();
    this.conversations.set(fresh);
    this.activeConversationId.set(fresh[0]?.id || '');
  }

  private getPreferredLanguage(): 'ar' | 'en' {
    if (typeof navigator === 'undefined') return 'en';
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }

  private detectLanguageFromText(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text || '') ? 'ar' : 'en';
  }

  startNewConversation() {
    const language = this.getPreferredLanguage();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      backendId: null,
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

    const language = this.detectLanguageFromText(text) || this.getPreferredLanguage();
    this.api.sendMessage(text, convo.backendId ?? convo.id, language).subscribe({
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
    const cleaned = content
      .replace(/\s+/g, ' ')
      .replace(/[؟?!.,؛:]+$/g, '')
      .trim();
    if (!cleaned) return 'User message';

    const lower = cleaned.toLowerCase();
    if (lower.startsWith('uploaded') || cleaned.startsWith('تم رفع')) {
      return cleaned.startsWith('تم رفع') ? 'مراجعة ملف' : 'Document review';
    }

    const max = 32;
    if (cleaned.length <= max) return cleaned;
    return `${cleaned.slice(0, max).trim()}…`;
  }

  private loadInitialConversations(): Conversation[] {
    const language = this.getPreferredLanguage();
    const starter: Conversation = {
      id: crypto.randomUUID(),
      backendId: null,
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

  loadConversationFromBackend(conversationId: string) {
    return forkJoin({
      meta: this.api.getChatConversation(conversationId),
      messages: this.api.listChatMessages(conversationId),
      uploads: this.api.listUploads(conversationId).pipe(
        map((res) => (Array.isArray(res?.documents) ? res.documents : [])),
        catchError(() => of([] as UploadDocumentRecord[])),
      ),
    }).pipe(
      map(({ meta, messages, uploads }) => {
        const mappedMessages = this.mapMessages(messages);
        const title = this.getDisplayTitle(meta, mappedMessages);
        const mergedMessages = this.mergeMessagesWithUploads(mappedMessages, uploads);
        const updatedAt = this.resolveUpdatedAt(meta, mergedMessages);
        const conversation: Conversation = {
          id: conversationId,
          backendId: conversationId,
          title: title || 'Chat',
          messages: mergedMessages,
          updatedAt,
        };

        this.conversations.update((list) => {
          const existing = list.find((item) => item.id === conversationId);
          if (existing) {
            return list.map((item) => (item.id === conversationId ? conversation : item));
          }
          return [conversation, ...list];
        });
        this.activeConversationId.set(conversationId);
        return conversation;
      }),
    );
  }

  private mapMessages(rows: ChatMessageRecord[]): Message[] {
    return (rows || []).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      timestamp: new Date(row.createdAt).getTime(),
    }));
  }

  private getDisplayTitle(meta: ChatConversationSummary, messages: Message[]) {
    const rawTitle = String(meta?.title || '').trim();
    const preferred = rawTitle && rawTitle !== 'New compliance chat' ? rawTitle : '';
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const fallback = lastUser?.content || messages[messages.length - 1]?.content || '';
    return this.formatTitle(preferred || fallback) || 'Chat';
  }

  private resolveUpdatedAt(meta: ChatConversationSummary, messages: Message[]) {
    const metaTime = meta?.updatedAt ? new Date(meta.updatedAt).getTime() : 0;
    const lastMessageTime = messages[messages.length - 1]?.timestamp || 0;
    return Math.max(metaTime, lastMessageTime, Date.now());
  }

  private mergeMessagesWithUploads(messages: Message[], uploads: UploadDocumentRecord[]) {
    if (!uploads.length) return messages;
    const language = this.detectLanguageFromEvidence(messages, uploads);
    const uploadMessages = uploads.flatMap((doc) => {
      const createdAt = new Date(doc.createdAt || Date.now()).getTime();
      const summary = {
        id: `upload-summary-${doc.id}`,
        role: 'user' as const,
        content:
          language === 'ar'
            ? `تم رفع ملف: ${doc.originalName || 'ملف'}`
            : `Uploaded 1 document: ${doc.originalName || 'document'}`,
        timestamp: createdAt,
      };
      const analysis = {
        id: `upload-${doc.id}`,
        role: 'assistant' as const,
        content: this.buildUploadAnalysisContent(doc, language),
        timestamp: new Date(doc.reviewedAt || doc.createdAt || Date.now()).getTime() + 1,
      };
      return [summary, analysis];
    });
    return [...messages, ...uploadMessages].sort((a, b) => a.timestamp - b.timestamp);
  }

  private detectLanguageFromEvidence(messages: Message[], uploads: UploadDocumentRecord[]): 'ar' | 'en' {
    const samples: string[] = [];
    messages.forEach((message) => samples.push(message.content || ''));
    uploads.forEach((doc) => {
      samples.push(String(doc?.docType || ''));
      samples.push(String(doc?.matchNote || ''));
    });
    const joined = samples.join(' ');
    return /[\u0600-\u06FF]/.test(joined) ? 'ar' : 'en';
  }

  private buildUploadAnalysisContent(doc: UploadDocumentRecord, language: 'ar' | 'en') {
    const fallbackName = language === 'ar' ? 'ملف مرفوع' : 'Uploaded document';
    const fileName = doc?.originalName || fallbackName;
    const docType = doc?.docType
      ? language === 'ar'
        ? `النوع: ${doc.docType}`
        : `Type: ${doc.docType}`
      : '';
    const controlId = doc?.matchControlId
      ? language === 'ar'
        ? `الكنترول: ${doc.matchControlId}`
        : `Control: ${doc.matchControlId}`
      : language === 'ar'
        ? 'الكنترول: غير محدد'
        : 'Control: Not identified';
    const matchStatus = String(doc?.matchStatus || 'UNKNOWN').toUpperCase();
    const statusLabel =
      matchStatus === 'COMPLIANT'
        ? language === 'ar'
          ? 'مناسب كدليل'
          : 'Ready to submit'
        : matchStatus === 'PARTIAL'
          ? language === 'ar'
            ? 'دليل جزئي'
            : 'Partial evidence'
          : matchStatus === 'NOT_COMPLIANT'
            ? language === 'ar'
              ? 'غير مناسب كدليل'
              : 'Not evidence'
            : language === 'ar'
              ? 'يحتاج مراجعة'
              : 'Needs review';
    const note = doc?.matchNote
      ? language === 'ar'
        ? `ملاحظة: ${doc.matchNote}`
        : `AI note: ${doc.matchNote}`
      : '';
    const recs = Array.isArray(doc?.matchRecommendations) ? doc.matchRecommendations.slice(0, 3) : [];
    const frameworkRefs = Array.isArray(doc?.frameworkReferences)
      ? doc.frameworkReferences.filter(Boolean)
      : [];
    const lines = [
      `📎 ${fileName}`,
      docType,
      controlId,
      language === 'ar' ? `الحالة: ${statusLabel}` : `Status: ${statusLabel}`,
      note,
    ].filter(Boolean);

    if (frameworkRefs.length) {
      lines.push(language === 'ar' ? 'مراجع الفريموركات:' : 'Framework references:');
      lines.push(frameworkRefs.map((ref) => `- ${ref}`).join('\n'));
    }
    if (recs.length) {
      lines.push(language === 'ar' ? 'الخطوات القادمة:' : 'Next steps:');
      lines.push(recs.map((rec) => `- ${rec}`).join('\n'));
    }

    return lines.filter(Boolean).join('\n');
  }

  private formatTitle(value: string) {
    const cleaned = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/[؟?!.,؛:]+$/g, '')
      .trim();
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    if (lower.startsWith('uploaded') || cleaned.startsWith('تم رفع')) {
      return cleaned.startsWith('تم رفع') ? 'مراجعة ملف' : 'Document review';
    }
    const max = 40;
    return cleaned.length > max ? `${cleaned.slice(0, max).trim()}…` : cleaned;
  }
}
