import { Injectable, computed, signal } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Conversation } from '../models/conversation.model';
import { Message, MessageAction } from '../models/message.model';
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

  resetForUser(userName?: string | null) {
    const fresh = this.loadInitialConversations(userName);
    this.conversations.set(fresh);
    this.activeConversationId.set(fresh[0]?.id || '');
  }

  personalizeStarterGreeting(userName?: string | null) {
    const displayName = this.normalizeDisplayName(userName);
    if (!displayName) return;
    const normalizedGreeting = this.buildWelcomeMessage(displayName, this.getPreferredLanguage());

    this.conversations.update((list) =>
      list.map((conversation) => {
        const first = conversation.messages?.[0];
        if (!first || first.role !== 'assistant') return conversation;
        const content = String(first.content || '').trim().toLowerCase();
        const isStarter =
          content === 'hello! how can i help you today?'
          || content === 'أهلا! أقدر أساعدك في إيه النهارده؟'
          || content === 'أهلاً! أقدر أساعدك في إيه النهارده؟';
        if (!isStarter) return conversation;

        return {
          ...conversation,
          messages: [
            { ...first, content: normalizedGreeting },
            ...conversation.messages.slice(1),
          ],
          updatedAt: Date.now(),
        };
      }),
    );
  }

  private getPreferredLanguage(): 'ar' | 'en' {
    if (typeof navigator === 'undefined') return 'en';
    const lang = String(navigator.language || '').toLowerCase();
    return lang.startsWith('ar') ? 'ar' : 'en';
  }

  private detectLanguageFromText(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text || '') ? 'ar' : 'en';
  }

  startNewConversation(userName?: string | null) {
    const language = this.getPreferredLanguage();
    const displayName = this.normalizeDisplayName(userName);
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      backendId: null,
      title: 'New compliance chat',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: this.buildWelcomeMessage(displayName, language),
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

  private loadInitialConversations(userName?: string | null): Conversation[] {
    const language = this.getPreferredLanguage();
    const displayName = this.normalizeDisplayName(userName);
    const starter: Conversation = {
      id: crypto.randomUUID(),
      backendId: null,
      title: 'Launch checklist',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: this.buildWelcomeMessage(displayName, language),
          timestamp: Date.now() - 1000 * 60 * 5,
        },
      ],
      updatedAt: Date.now(),
    };

    return [starter];
  }

  private normalizeDisplayName(value?: string | null) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const token = raw.split(/\s+/)[0] || '';
    return token.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 24);
  }

  private buildWelcomeMessage(displayName: string, language: 'ar' | 'en') {
    if (language === 'ar') {
      if (displayName) return `أهلاً يا ${displayName}! أقدر أساعدك في إيه النهارده؟`;
      return 'أهلاً! أقدر أساعدك في إيه النهارده؟';
    }
    if (displayName) return `Hello ${displayName}! How can I help you today?`;
    return 'Hello! How can I help you today?';
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
        const availableDocuments = uploads
          .map((doc) => ({
            id: String(doc?.id || '').trim(),
            name: String(doc?.originalName || '').trim(),
            mimeType: String(doc?.mimeType || '').trim() || null,
            createdAt: String(doc?.createdAt || '').trim() || null,
          }))
          .filter((doc) => doc.id && doc.name)
          .sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
          });
        const conversation: Conversation = {
          id: conversationId,
          backendId: conversationId,
          title: title || 'Chat',
          messages: mergedMessages,
          updatedAt,
          availableDocuments,
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
      messageType: row.messageType || 'TEXT',
      cards: Array.isArray(row.cards) ? row.cards : undefined,
      sources: this.sanitizeSourcesForUi(row.sources),
      actions: this.mapStructuredActions(row.actions),
    }));
  }

  private sanitizeSourcesForUi(
    value: unknown,
  ): Array<{ objectType: string; id: string; snippetRef: string | null }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const sanitized = value
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const source = item as {
          objectType?: unknown;
          id?: unknown;
          snippetRef?: unknown;
        };
        return {
          objectType: String(source.objectType || '').trim(),
          id: String(source.id || '').trim(),
          snippetRef:
            source.snippetRef === null || source.snippetRef === undefined
              ? null
              : String(source.snippetRef || ''),
        };
      })
      .filter(
        (source) =>
          source.objectType &&
          source.id &&
          source.objectType.toLowerCase() !== 'routemeta',
      );
    return sanitized.length ? sanitized : undefined;
  }

  private mapStructuredActions(
    actions: ChatMessageRecord['actions'],
  ): MessageAction[] | undefined {
    if (!Array.isArray(actions) || !actions.length) return undefined;
    const mapped = actions.reduce<MessageAction[]>((acc, action) => {
      const actionType = String(action?.actionType || '').trim().toUpperCase();
      const label = String(action?.label || '').trim();
      if (
        actionType !== 'CREATE_EVIDENCE_REQUEST' &&
        actionType !== 'LINK_EVIDENCE_CONTROL' &&
        actionType !== 'CREATE_REMEDIATION_TASK'
      ) {
        return acc;
      }
      acc.push({
        id: `copilot:${actionType.toLowerCase()}`,
        label: label || actionType.replaceAll('_', ' '),
        meta: {
          copilotActionType: actionType,
          payload: action?.payload || {},
          dryRun: true,
        },
      });
      return acc;
    }, []);
    return mapped.length ? mapped : undefined;
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
      const documentId = String(doc?.id || '').trim();
      const compactContent = this.buildUploadCompactContent(doc, language);
      const analysis = {
        id: `upload-${doc.id}`,
        role: 'assistant' as const,
        content: compactContent,
        timestamp: new Date(doc.reviewedAt || doc.createdAt || Date.now()).getTime() + 1,
        actions: documentId
          ? this.buildUploadCollapsedActions(documentId, language, compactContent)
          : undefined,
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

  private buildUploadStatusLabel(matchStatus: string, language: 'ar' | 'en') {
    if (matchStatus === 'COMPLIANT') {
      return language === 'ar' ? 'مناسب كدليل' : 'Ready to submit';
    }
    if (matchStatus === 'PARTIAL') {
      return language === 'ar' ? 'دليل جزئي' : 'Partial evidence';
    }
    if (matchStatus === 'NOT_COMPLIANT') {
      return language === 'ar' ? 'غير مناسب كدليل' : 'Not evidence';
    }
    return language === 'ar' ? 'يحتاج مراجعة' : 'Needs review';
  }

  private buildUploadCompactContent(doc: UploadDocumentRecord, language: 'ar' | 'en') {
    const fallbackName = language === 'ar' ? 'ملف مرفوع' : 'Uploaded document';
    const fileName = doc?.originalName || fallbackName;
    const matchStatus = String(doc?.matchStatus || 'UNKNOWN').toUpperCase();
    const statusLabel = this.buildUploadStatusLabel(matchStatus, language);
    const controlLine = doc?.matchControlId
      ? language === 'ar'
        ? `الكنترول: ${doc.matchControlId}`
        : `Control: ${doc.matchControlId}`
      : language === 'ar'
        ? 'الكنترول: غير محدد'
        : 'Control: Not identified';
    const hint =
      language === 'ar'
        ? 'التفاصيل مخفية. اضغط "عرض التفاصيل" عند الحاجة.'
        : 'Details are hidden. Click "Show details" when needed.';

    return [
      `📎 ${fileName}`,
      language === 'ar' ? `الحالة: ${statusLabel}` : `Status: ${statusLabel}`,
      controlLine,
      hint,
    ].join('\n');
  }

  private buildShowUploadDetailsAction(
    documentId: string,
    language: 'ar' | 'en',
    compactContent: string,
  ): MessageAction {
    return {
      id: 'show_upload_details',
      label: language === 'ar' ? 'عرض التفاصيل' : 'Show details',
      meta: {
        documentId,
        compactContent,
        uiMode: 'collapsed',
      },
    };
  }

  private buildReevaluateAction(
    documentId: string,
    language: 'ar' | 'en',
    compactContent: string,
  ): MessageAction {
    return {
      id: 'reevaluate',
      label: language === 'ar' ? 'إعادة التقييم' : 'Re-evaluate',
      meta: {
        documentId,
        compactContent,
        uiMode: 'collapsed',
      },
    };
  }

  private buildUploadCollapsedActions(
    documentId: string,
    language: 'ar' | 'en',
    compactContent: string,
  ): MessageAction[] {
    return [
      this.buildShowUploadDetailsAction(documentId, language, compactContent),
      this.buildReevaluateAction(documentId, language, compactContent),
    ];
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
