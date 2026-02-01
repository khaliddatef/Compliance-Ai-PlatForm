import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Message } from '../../models/message.model';
import {
  ApiService,
  ChatConversationSummary,
  ChatMessageRecord,
  UploadDocumentRecord,
} from '../../services/api.service';
import { ChatHeaderComponent } from '../../components/chat-header/chat-header.component';
import { MessageListComponent } from '../../components/message-list/message-list.component';

@Component({
  selector: 'app-chat-viewer-page',
  standalone: true,
  imports: [CommonModule, ChatHeaderComponent, MessageListComponent],
  templateUrl: './chat-viewer-page.component.html',
  styleUrl: './chat-viewer-page.component.css',
})
export class ChatViewerPageComponent implements OnInit {
  conversationId = '';
  title = 'Chat';
  subtitle = '';
  messages: Message[] = [];
  loading = true;
  error = '';

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('conversationId');
      if (!id) {
        this.error = 'Conversation not found.';
        this.loading = false;
        this.cdr.markForCheck();
        return;
      }
      this.conversationId = id;
      this.loadConversation(id);
    });
  }

  backToHistory() {
    this.router.navigate(['/history']);
  }

  private loadConversation(conversationId: string) {
    this.loading = true;
    this.error = '';
    this.cdr.markForCheck();

    forkJoin({
      meta: this.api.getChatConversation(conversationId),
      messages: this.api.listChatMessages(conversationId),
      uploads: this.api.listUploads(conversationId).pipe(
        map((res) => (Array.isArray(res?.documents) ? res.documents : [])),
        catchError(() => of([] as UploadDocumentRecord[])),
      ),
    }).subscribe({
      next: ({ meta, messages, uploads }) => {
        const mappedMessages = this.mapMessages(messages);
        this.title = this.getDisplayTitle(meta, mappedMessages);
        this.subtitle = this.buildSubtitle(meta);
        this.messages = this.mergeMessagesWithUploads(mappedMessages, uploads);
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load this conversation.';
        this.loading = false;
        this.cdr.markForCheck();
      },
      complete: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  private buildSubtitle(meta: ChatConversationSummary) {
    const name = meta?.user?.name?.trim();
    const email = meta?.user?.email?.trim();
    if (name && email) return `By ${name} · ${email}`;
    if (name) return `By ${name}`;
    if (email) return `By ${email}`;
    return '';
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

  private mergeMessagesWithUploads(messages: Message[], uploads: UploadDocumentRecord[]) {
    if (!uploads.length) return messages;
    const language = this.detectLanguage(messages, uploads);
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

  private detectLanguage(messages: Message[], uploads: UploadDocumentRecord[]): 'ar' | 'en' {
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
      lines.push(...frameworkRefs.map((item: string) => `- ${item}`));
    }

    if (recs.length) {
      lines.push(language === 'ar' ? 'الخطوات القادمة:' : 'Next steps:');
      lines.push(...recs.map((item: string) => `- ${item}`));
    }

    return lines.join('\n');
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
