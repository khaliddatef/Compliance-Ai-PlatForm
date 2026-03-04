import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import { Message, MessageAction, MessageActionId } from '../../models/message.model';
import {
  ApiService,
  ChatApiResponse,
  ControlCatalogItem,
  ControlEvaluation,
  ControlContext,
} from '../../services/api.service';
import { ChatService } from '../../services/chat.service';
import { ChatHeaderComponent } from '../../components/chat-header/chat-header.component';
import {
  ComposerComponent,
  ComposerMentionOption,
  ComposerSendPayload,
} from '../../components/composer/composer.component';
import { MessageListComponent } from '../../components/message-list/message-list.component';
import { AuthService } from '../../services/auth.service';
import { ControlState, ControlStatus } from '../../models/conversation.model';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, ChatHeaderComponent, ComposerComponent, MessageListComponent],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent implements OnInit, OnDestroy {
  typing = false;
  uploading = false;
  uploadProgress = 0;
  attachmentResetKey = 0;
  private globalMentionOptions: ComposerMentionOption[] = [];

  private controls: ControlCatalogItem[] = [];
  private controlsLoaded = false;
  private controlsLoading = false;
  private controlCatalogUnavailable = false;
  private readonly controlContextCache = new Map<string, ControlContext>();
  private readonly controlContextInflight = new Map<string, Promise<ControlContext | null>>();
  private getActionButtons(): MessageAction[] {
    const language = this.getLanguageHint();
    if (language === 'ar') {
      return [
        { id: 'save', label: 'اعتماد كدليل' },
        { id: 'partial', label: 'اعتماد كدليل جزئي' },
        { id: 'fix', label: 'ازاي نكمل المطلوب؟' },
        { id: 'skip', label: 'تخطي مؤقتًا' },
      ];
    }
    return [
      { id: 'save', label: 'Submit as Evidence' },
      { id: 'partial', label: 'Submit as Partial Evidence' },
      { id: 'fix', label: 'Ask how to fix missing requirements' },
      { id: 'skip', label: 'Skip for now' },
    ];
  }

  private routeSub?: Subscription;

  constructor(
    private readonly chatService: ChatService,
    private readonly apiService: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

  ngOnInit() {
    this.loadControlCatalog();
    this.loadGlobalMentionOptions();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const conversationId = params.get('conversationId');

      if (conversationId) {
        const exists = this.chatService.conversations().some((c) => c.id === conversationId);
        if (exists) {
          this.chatService.selectConversation(conversationId);
          this.ensureControlFlow();
          this.maybePromptAfterCatalogLoad();
          return;
        }
        this.chatService.loadConversationFromBackend(conversationId).subscribe({
          next: () => {
            this.ensureControlFlow();
            this.maybePromptAfterCatalogLoad();
          },
          error: () => {
            this.chatService.startNewConversation(this.getUserName());
            this.ensureControlFlow();
            this.maybePromptAfterCatalogLoad();
          },
        });
        return;
      }

      const active = this.chatService.activeConversation();
      if (active) {
        this.ensureControlFlow();
        this.maybePromptAfterCatalogLoad();
        return;
      }

      const list = this.chatService.conversations();
      if (list.length) {
        this.chatService.selectConversation(list[0].id);
        this.ensureControlFlow();
        this.maybePromptAfterCatalogLoad();
        return;
      }

      this.chatService.startNewConversation(this.getUserName());
      this.ensureControlFlow();
      this.maybePromptAfterCatalogLoad();
    });
  }

  ngOnDestroy() {
    this.routeSub?.unsubscribe();
  }

  get messages(): Message[] {
    return this.chatService.activeConversation()?.messages ?? [];
  }

  get conversationTitle() {
    return this.chatService.activeConversation()?.title || 'Compliance workspace';
  }

  get mentionOptions(): ComposerMentionOption[] {
    const conversationDocs = this.chatService.activeConversation()?.availableDocuments || [];
    const merged = [...conversationDocs, ...this.globalMentionOptions];
    const seen = new Set<string>();
    const normalized: ComposerMentionOption[] = [];

    merged.forEach((doc) => {
      const id = String(doc?.id || '').trim();
      const name = String(doc?.name || '').trim();
      if (!id || !name || seen.has(id)) return;
      seen.add(id);
      normalized.push({
        id,
        name,
        mimeType: doc?.mimeType || null,
        createdAt: doc?.createdAt || null,
      });
    });

    return normalized
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 300);
  }

  startNewChat() {
    this.chatService.startNewConversation(this.getUserName());
    this.router.navigate(['/home'], { replaceUrl: true });
    this.ensureControlFlow();
    this.maybePromptAfterCatalogLoad();
  }

  handleComposerSend(payload: ComposerSendPayload) {
    const text = (payload?.text ?? '').trim();
    const files = payload?.files ?? [];
    const mentionDocumentIds = Array.isArray(payload?.mentionedDocumentIds)
      ? payload.mentionedDocumentIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];

    if (!text && files.length === 0) return;

    const active = this.chatService.activeConversation() || this.chatService.startNewConversation(this.getUserName());

    // ✅ ارفع الأول (عشان يبقى available في RAG)
    if (files.length) {
      const deferredText = text || undefined;
      this.uploadDocs(files, active.id, deferredText, mentionDocumentIds);
      if (text) {
        this.chatService.appendMessage(active.id, {
          id: crypto.randomUUID(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (text) {
      this.sendMessage(text, active.id, { mentionDocumentIds });
    }
  }

  handleActionSelected(event: { messageId: string; action: MessageAction }) {
    const active = this.chatService.activeConversation();
    if (!active) return;

    if (event.action.id === 'show_upload_details') {
      this.handleShowUploadDetails(active.id, event.messageId, event.action);
      return;
    }

    if (event.action.id === 'hide_upload_details') {
      this.handleHideUploadDetails(active.id, event.messageId, event.action);
      return;
    }

    if (this.isCopilotAction(event.action)) {
      this.handleCopilotAction(active.id, event.messageId, event.action);
      return;
    }

    if (event.action.id === 'reevaluate') {
      this.handleReevaluateAction(active.id, event.messageId, event.action);
      return;
    }

    this.chatService.updateMessage(active.id, event.messageId, { actions: undefined });
    this.chatService.appendMessage(active.id, {
      id: crypto.randomUUID(),
      role: 'user',
      content: event.action.label,
      kind: 'action',
      timestamp: Date.now(),
    });

    const prompt = this.getActionPrompt(event.action.id);
    if (event.action.id !== 'fix') {
      this.applyControlAction(active.id, event.action.id);
    }
    if (prompt) {
      this.sendMessage(prompt, active.id, { showActions: false, hideUserMessage: true });
    }
  }

  private sendMessage(
    text: string,
    conversationId: string,
    options: { showActions?: boolean; hideUserMessage?: boolean; mentionDocumentIds?: string[] } = {},
  ) {
    if (!options.hideUserMessage) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      this.chatService.appendMessage(conversationId, userMessage);
    }
    this.typing = true;

    this.maybeStartControlFlow(conversationId, text);

    const prompt = this.buildPrompt(text, conversationId);
    const showActions = options.showActions ?? this.isControlFlowActive();
    const language = this.getLanguageHint();
    const mentionDocumentIds = this.resolveMentionDocumentIds(
      text,
      options.mentionDocumentIds || [],
      conversationId,
    );
    this.apiService
      .sendMessage(prompt, conversationId, language, mentionDocumentIds)
      .subscribe({
      next: (raw: ChatApiResponse) => {
        const replyText = String(raw?.reply ?? raw?.assistantMessage ?? '');
        const cards = Array.isArray(raw?.cards) ? raw.cards : [];
        const sources = this.sanitizeSourcesForUi(raw?.sources);
        const structuredActions = this.mapCopilotActions(raw?.actions);
        const externalLinks = Array.isArray(raw?.externalLinks) ? raw.externalLinks : [];
        const firstLink = externalLinks[0];
        const reference = firstLink
          ? {
              type: 'link' as const,
              label: language === 'ar' ? 'مصدر' : 'Source',
              url: firstLink.url,
            }
          : undefined;

        if (showActions !== false || structuredActions.length > 0) {
          this.chatService.clearActions(conversationId);
        }

        const workflowActions = showActions === false ? [] : this.getActionButtons();
        const finalActions = structuredActions.length ? structuredActions : workflowActions;

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            replyText ||
            (language === 'ar' ? 'لا يوجد رد في الوقت الحالي.' : 'No reply.'),
          timestamp: Date.now(),
          messageType: raw?.messageType || 'TEXT',
          cards: cards.length ? cards : undefined,
          sources: sources.length ? sources : undefined,
          actions: finalActions.length ? finalActions : undefined,
          reference,
        };

        this.chatService.appendMessage(conversationId, assistantMessage);

      },
      error: (e) => {
        console.error('chat error', e);
        const fallback: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            language === 'ar'
              ? 'مش قادر أوصل للمساعد دلوقتي. جرّب مرة تانية لو سمحت.'
              : 'Unable to reach the assistant right now. Please try again.',
          timestamp: Date.now(),
        };
        this.chatService.appendMessage(conversationId, fallback);
        this.typing = false;
      },
      complete: () => {
        this.typing = false;
      },
      });
  }

  private resolveMentionDocumentIds(
    prompt: string,
    explicitMentionDocumentIds: string[],
    conversationId: string,
  ) {
    const explicitIds = Array.isArray(explicitMentionDocumentIds)
      ? Array.from(
          new Set(
            explicitMentionDocumentIds
              .map((id) => String(id || '').trim())
              .filter(Boolean),
          ),
        )
      : [];
    if (explicitIds.length) return explicitIds;

    const active = this.chatService.activeConversation();
    if (!active || active.id !== conversationId) return [];

    const latestUploadIds = Array.isArray(active.lastUploadIds)
      ? Array.from(new Set(active.lastUploadIds.map((id) => String(id || '').trim()).filter(Boolean)))
      : [];
    if (!latestUploadIds.length) return [];

    if (!this.shouldAutoAttachLatestUpload(prompt, active.lastUploadAt)) return [];
    return latestUploadIds;
  }

  private shouldAutoAttachLatestUpload(prompt: string, lastUploadAt?: number) {
    const raw = String(prompt || '').trim();
    if (!raw) return false;

    const stripped = raw
      .toLowerCase()
      .replace(/[!?.,;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!stripped) return false;

    const smallTalk = new Set([
      'hi',
      'hello',
      'hey',
      'thanks',
      'thank you',
      'thx',
      'مرحبا',
      'اهلا',
      'أهلا',
      'هاي',
      'السلام عليكم',
    ]);
    if (smallTalk.has(stripped)) return false;

    const fileIntentPattern =
      /(this file|this document|uploaded file|uploaded document|have a look|take a look|look at (it|this|that)|check (it|this|that)|review (it|this|that)|analy[sz]e (it|this|that)|summari[sz]e (it|this|that)|what do you think|tell me what do you think|read (it|this|that)|inspect (it|this|that)|have a quick look|بص|شوف|راجع|حلل|لخص|اقر|اقرأ|إيه رأيك|ايه رايك|ده كده|دا كدا|بص كدا|شوف كدا)/i;
    if (fileIntentPattern.test(raw)) return true;

    const tokenCount = stripped.split(' ').filter(Boolean).length;
    const withinWindow =
      typeof lastUploadAt === 'number' && Date.now() - lastUploadAt <= 5 * 60 * 1000;
    return withinWindow && tokenCount <= 5;
  }

  private sanitizeSourcesForUi(
    value: unknown,
  ): Array<{ objectType: string; id: string; snippetRef: string | null }> {
    if (!Array.isArray(value)) return [];
    return value
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
  }

  private isCopilotAction(action: MessageAction) {
    const actionType = action.meta?.copilotActionType;
    return (
      action.id.startsWith('copilot:') ||
      actionType === 'CREATE_EVIDENCE_REQUEST' ||
      actionType === 'LINK_EVIDENCE_CONTROL' ||
      actionType === 'CREATE_REMEDIATION_TASK'
    );
  }

  private handleCopilotAction(conversationId: string, messageId: string, action: MessageAction) {
    const language = this.getLanguageHint();

    if (action.id === 'copilot:cancel') {
      this.chatService.updateMessage(conversationId, messageId, { actions: undefined });
      this.appendAssistantMessage(
        conversationId,
        language === 'ar' ? 'تم إلغاء التنفيذ.' : 'Execution cancelled.',
      );
      return;
    }

    const actionType = action.meta?.copilotActionType;
    if (
      actionType !== 'CREATE_EVIDENCE_REQUEST' &&
      actionType !== 'LINK_EVIDENCE_CONTROL' &&
      actionType !== 'CREATE_REMEDIATION_TASK'
    ) {
      this.appendAssistantMessage(
        conversationId,
        language === 'ar' ? 'نوع الإجراء غير مدعوم.' : 'Unsupported action type.',
      );
      return;
    }

    const payload = action.meta?.payload || {};
    const dryRun = action.meta?.dryRun !== false;
    const idempotencyKey = crypto.randomUUID();

    this.chatService.updateMessage(conversationId, messageId, { actions: undefined });

    this.typing = true;
    this.apiService.executeCopilotAction(
      {
        actionType,
        payload,
        dryRun,
      },
      idempotencyKey,
    ).subscribe({
      next: (res) => {
        const resultView = this.buildCopilotResultView(res?.action, language);
        if (dryRun) {
          this.chatService.appendMessage(conversationId, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: resultView.content,
            messageType: 'AI_STRUCTURED',
            cards: resultView.cards,
            timestamp: Date.now(),
            actions: [
              {
                id: 'copilot:execute',
                label: language === 'ar' ? 'تنفيذ الآن' : 'Execute now',
                meta: {
                  copilotActionType: actionType,
                  payload,
                  dryRun: false,
                },
              },
              {
                id: 'copilot:cancel',
                label: language === 'ar' ? 'إلغاء' : 'Cancel',
              },
            ],
          });
          return;
        }

        this.chatService.appendMessage(conversationId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: resultView.content,
          messageType: 'AI_STRUCTURED',
          cards: resultView.cards,
          timestamp: Date.now(),
        });
      },
      error: (error) => {
        console.error('copilot action error', error);
        const status = Number(error?.status || 0);
        const serverMessage = String(error?.error?.message || '').trim();
        let message =
          language === 'ar'
            ? 'تعذر تنفيذ الإجراء الآن. راجع البيانات وحاول مرة أخرى.'
            : 'Unable to execute this action right now. Review payload and retry.';

        if (status === 403) {
          message =
            language === 'ar'
              ? 'هذا الإجراء متاح للـManager/Admin فقط.'
              : 'This action is available for Manager/Admin roles only.';
        } else if (status === 404) {
          message =
            language === 'ar'
              ? 'ميزة الإجراءات الذكية غير مفعلة حاليًا.'
              : 'Copilot actions are currently disabled.';
        } else if (status === 400 && serverMessage) {
          message =
            language === 'ar'
              ? `تعذر تنفيذ الإجراء: ${serverMessage}`
              : `Unable to execute action: ${serverMessage}`;
        }

        this.appendAssistantMessage(conversationId, message);
      },
      complete: () => {
        this.typing = false;
      },
    });
  }

  private mapCopilotActions(actions: ChatApiResponse['actions'] | undefined): MessageAction[] {
    if (!Array.isArray(actions) || !actions.length) return [];
    return actions.reduce<MessageAction[]>((acc, action) => {
      const actionType = String(action?.actionType || '').trim().toUpperCase() as
        | 'CREATE_EVIDENCE_REQUEST'
        | 'LINK_EVIDENCE_CONTROL'
        | 'CREATE_REMEDIATION_TASK';
      if (
        actionType !== 'CREATE_EVIDENCE_REQUEST' &&
        actionType !== 'LINK_EVIDENCE_CONTROL' &&
        actionType !== 'CREATE_REMEDIATION_TASK'
      ) {
        return acc;
      }
      acc.push({
        id: `copilot:${actionType.toLowerCase()}`,
        label: String(action?.label || this.getDefaultCopilotLabel(actionType)),
        meta: {
          copilotActionType: actionType,
          payload: action?.payload || {},
          dryRun: true,
        },
      });
      return acc;
    }, []);
  }

  private getDefaultCopilotLabel(
    actionType: 'CREATE_EVIDENCE_REQUEST' | 'LINK_EVIDENCE_CONTROL' | 'CREATE_REMEDIATION_TASK',
  ) {
    const language = this.getLanguageHint();
    if (language === 'ar') {
      if (actionType === 'CREATE_EVIDENCE_REQUEST') return 'إنشاء طلب دليل';
      if (actionType === 'LINK_EVIDENCE_CONTROL') return 'ربط الدليل بالكنترول';
      return 'إنشاء مهمة معالجة';
    }
    if (actionType === 'CREATE_EVIDENCE_REQUEST') return 'Create evidence request';
    if (actionType === 'LINK_EVIDENCE_CONTROL') return 'Link evidence to control';
    return 'Create remediation task';
  }

  private buildCopilotResultView(result: any, language: 'ar' | 'en') {
    const actionType = String(result?.actionType || '').toUpperCase();
    const isDryRun = Boolean(result?.dryRun);
    const payload = result?.result || {};
    const actionLabel = this.getActionDisplayLabel(actionType, language);
    const detailSource = isDryRun ? payload?.preview || payload : payload;
    const detailItems = this.toCopilotDetailItems(detailSource, language);

    const summaryLine = isDryRun
      ? language === 'ar'
        ? `معاينة جاهزة لـ ${actionLabel}`
        : `Dry-run preview ready for ${actionLabel}`
      : language === 'ar'
        ? `تم تنفيذ ${actionLabel}`
        : `Executed ${actionLabel}`;

    const cards = [
      {
        type: 'summary',
        title: language === 'ar' ? 'Summary' : 'Summary',
        lines: [summaryLine],
      },
      {
        type: 'assessment',
        title: language === 'ar' ? 'Action Result' : 'Action Result',
        status: isDryRun ? 'Preview' : 'Executed',
        scope: actionLabel,
      },
      {
        type: 'details',
        title: language === 'ar' ? 'Details' : 'Details',
        items: detailItems.length
          ? detailItems
          : [language === 'ar' ? 'لا توجد تفاصيل إضافية.' : 'No additional details.'],
      },
    ];

    return {
      content: summaryLine,
      cards,
    };
  }

  private getActionDisplayLabel(actionType: string, language: 'ar' | 'en') {
    const normalized = String(actionType || '').trim().toUpperCase();
    if (normalized === 'CREATE_EVIDENCE_REQUEST') {
      return language === 'ar' ? 'إنشاء طلب دليل' : 'Create evidence request';
    }
    if (normalized === 'LINK_EVIDENCE_CONTROL') {
      return language === 'ar' ? 'ربط الدليل بالكنترول' : 'Link evidence to control';
    }
    if (normalized === 'CREATE_REMEDIATION_TASK') {
      return language === 'ar' ? 'إنشاء مهمة معالجة' : 'Create remediation task';
    }
    return normalized || (language === 'ar' ? 'إجراء' : 'Action');
  }

  private toCopilotDetailItems(value: unknown, language: 'ar' | 'en') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value as Record<string, unknown>)
      .filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined && String(fieldValue).trim() !== '')
      .map(([key, fieldValue]) => {
        const label = this.formatCopilotFieldLabel(key, language);
        const text = this.stringifyCopilotField(fieldValue);
        return `${label}: ${text}`;
      })
      .filter((item) => item.trim().length > 0);
  }

  private formatCopilotFieldLabel(key: string, language: 'ar' | 'en') {
    const pretty = key
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]+/g, ' ')
      .trim();
    if (language === 'ar') return pretty;
    return pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }

  private stringifyCopilotField(value: unknown) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      const compact = value
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(', ');
      return compact || '--';
    }
    if (value && typeof value === 'object') {
      const compact = JSON.stringify(value);
      return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
    }
    return '--';
  }

  private uploadDocs(
    files: File[],
    conversationId: string,
    deferredText?: string,
    deferredMentionDocumentIds?: string[],
  ) {
    const language = this.getLanguageHint();
    const summaryText = this.buildUploadSummary(files, language);
    this.chatService.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: summaryText,
      timestamp: Date.now(),
    });

    this.uploading = true;
    this.uploadProgress = 10;

    // ✅ دي اللي شغالة فعلاً في ApiService
    this.apiService.uploadCustomerFiles(conversationId, files, language).subscribe({
      next: (res: any) => {
        // backend بيرجع ingestResults وعدد chunks.. إلخ
        const ok = !!res?.ok;
        const count = Number(res?.count ?? files.length);
        const dedupedCount = Number(res?.dedupedCount ?? 0);
        const deferredPrompt = String(deferredText || '').trim();
        const hasDeferredPrompt = ok && Boolean(deferredPrompt);

        const ingestOk = Array.isArray(res?.ingestResults)
          ? res.ingestResults.filter((x: any) => x?.ok).length
          : undefined;

        const msg = ok
          ? language === 'ar'
            ? `✅ اكتمل الرفع${typeof ingestOk === 'number' ? ` (المعالجة: ${ingestOk}/${count})` : ''}${dedupedCount > 0 ? ` — تم اكتشاف ${dedupedCount} ملف مكرر واستخدام التحليل السابق.` : ''}.`
            : `✅ Upload complete${typeof ingestOk === 'number' ? ` (ingested: ${ingestOk}/${count})` : ''}${dedupedCount > 0 ? ` — detected ${dedupedCount} duplicate file(s), reused previous analysis.` : ''}.`
          : language === 'ar'
            ? '⚠️ تم الرفع لكن الرد غير متوقع.'
            : '⚠️ Upload finished but response is unexpected.';

        // Keep chat concise when user already asked a question with the upload.
        // In that case we avoid extra upload-status/analysis bubbles and send one final answer only.
        if (!hasDeferredPrompt) {
          this.appendAssistantMessage(conversationId, msg);
        }

        const uploadedDocs = Array.isArray(res?.documents) ? res.documents : [];
        if (uploadedDocs.length) {
          const docIds = uploadedDocs.map((doc: any) => String(doc.id)).filter(Boolean);
          const existingDocs = this.chatService.activeConversation()?.availableDocuments || [];
          const nextDocs = [...existingDocs];
          uploadedDocs.forEach((doc: any) => {
            const id = String(doc?.id || '').trim();
            const name = String(doc?.originalName || '').trim();
            if (!id || !name) return;
            if (nextDocs.some((item) => item.id === id)) return;
            nextDocs.unshift({
              id,
              name,
              mimeType: String(doc?.mimeType || '').trim() || null,
              createdAt: String(doc?.createdAt || '').trim() || null,
            });
          });
          this.chatService.updateConversation(conversationId, {
            lastUploadIds: docIds,
            lastUploadAt: Date.now(),
            availableDocuments: nextDocs,
          });
        }

        if (!hasDeferredPrompt) {
          const dedupedDocIds = new Set<string>(
            (Array.isArray(res?.dedupedDocuments) ? res.dedupedDocuments : [])
              .map((entry: any) => String(entry?.createdDocumentId || '').trim())
              .filter(Boolean),
          );
          this.appendUploadAnalysis(conversationId, res, {
            skipDocumentIds: dedupedDocIds,
          });
        }

        const control = this.getActiveControl();
        if (control && this.isControlFlowActive() && !hasDeferredPrompt) {
          void this.evaluateEvidence(conversationId, control);
        }
        if (hasDeferredPrompt) {
          this.sendMessage(deferredPrompt, conversationId, {
            hideUserMessage: true,
            mentionDocumentIds: deferredMentionDocumentIds || [],
          });
        }
        this.uploadProgress = 100;
      },
      error: (e) => {
        console.error('upload error', e);
        this.appendAssistantMessage(
          conversationId,
          language === 'ar' ? '❌ فشل رفع الملف. حاول مرة أخرى.' : '❌ Upload failed. Please try again.',
        );
        this.uploading = false;
        this.uploadProgress = 0;
      },
      complete: () => {
        this.uploading = false;
        this.uploadProgress = 100;
        this.attachmentResetKey++;
      },
    });
  }

  // Standard selection is fixed for now (UI coming in Frameworks page).

  private appendAssistantMessage(conversationId: string, content: string) {
    this.chatService.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  private getActionPrompt(actionId: MessageActionId) {
    const language = this.getLanguageHint();
    const prompts: Record<MessageActionId, string> =
      language === 'ar'
        ? {
            save: 'المستخدم اختار اعتماد كدليل. أكد الحفظ ووجّه المستخدم للكنترول التالي.',
            partial: 'المستخدم اختار اعتماد كدليل جزئي. أكد الحالة ووضح العناصر الناقصة بإيجاز.',
            fix: 'المستخدم طلب طريقة إصلاح النواقص. قدّم خطوات مختصرة وعملية.',
            skip: 'المستخدم اختار التخطي مؤقتًا. أكد التخطي ووجّه للكنترول التالي.',
            reevaluate: '',
          }
        : {
            save:
              'User chose: Submit as Evidence. Confirm it is saved and tell the user the next control to work on.',
            partial:
              'User chose: Submit as Partial Evidence. Confirm partial status and list missing items to complete.',
            fix:
              'User asked for remediation guidance. Provide concise steps to fix missing requirements.',
            skip:
              'User chose: Skip for now. Confirm skip and guide to the next control.',
            reevaluate: '',
          };
    return prompts[actionId];
  }

  private buildUploadSummary(files: File[], language: 'ar' | 'en') {
    const names = files.map((f) => f.name);
    const shortList = names.length > 2 ? `${names.slice(0, 2).join(', ')}…` : names.join(', ');
    if (language === 'ar') {
      return `تم رفع ${names.length} ملف${names.length === 1 ? '' : 'ات'}: ${shortList}`;
    }
    return `Uploaded ${names.length} ${names.length === 1 ? 'document' : 'documents'}: ${shortList}`;
  }

  private getUserName() {
    const rawName = this.auth.user()?.name?.trim();
    return rawName && rawName.length ? rawName : null;
  }

  private getLanguageHint(): 'ar' | 'en' {
    const active = this.chatService.activeConversation();
    const lastUser = [...(active?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'user' && message.content && message.kind !== 'action');
    const text = lastUser?.content || '';
    if (text && /[\u0600-\u06FF]/.test(text)) return 'ar';
    if (typeof navigator !== 'undefined') {
      const lang = String(navigator.language || '').toLowerCase();
      if (lang.startsWith('ar')) return 'ar';
    }
    return 'en';
  }

  private loadGlobalMentionOptions() {
    this.apiService.listAllUploads().subscribe({
      next: (res) => {
        const documents = Array.isArray(res?.documents) ? res.documents : [];
        this.globalMentionOptions = documents
          .map((doc) => ({
            id: String(doc?.id || '').trim(),
            name: String(doc?.originalName || '').trim(),
            mimeType: String(doc?.mimeType || '').trim() || null,
            createdAt: String(doc?.createdAt || '').trim() || null,
          }))
          .filter((doc) => doc.id && doc.name);
      },
      error: () => {
        this.globalMentionOptions = [];
      },
    });
  }

  private getActiveControl() {
    const active = this.chatService.activeConversation();
    const state = active?.controlState;
    if (!state) return null;
    return this.controls[state.currentIndex] ?? null;
  }

  private isControlFlowActive() {
    const state = this.chatService.activeConversation()?.controlState;
    return Boolean(state?.intakeComplete);
  }

  private ensureControlFlow() {
    this.loadControlCatalog();
    const active = this.chatService.activeConversation() || this.chatService.startNewConversation(this.getUserName());
    const name = this.getUserName();
    const currentState = active.controlState;
    if (currentState?.started) {
      if (name && currentState.greetedName !== name) {
        this.chatService.updateConversation(active.id, {
          controlState: { ...currentState, greetedName: name },
        });
        const language = this.getLanguageHint();
        this.appendAssistantMessage(
          active.id,
          language === 'ar' ? `أهلًا بعودتك ${name} 👋` : `Welcome back ${name} 👋`,
        );
      }
      return;
    }

    const initialState: ControlState = {
      started: true,
      intakeComplete: false,
      controlPrompted: false,
      currentIndex: 0,
      statuses: {},
      phase: 'Preparation',
      greetedName: name ?? undefined,
    };
    this.chatService.updateConversation(active.id, { controlState: initialState });

    if (active.messages.length === 0) {
      const language = this.getLanguageHint();
      const displayName = name || (language === 'ar' ? 'بيك' : 'there');
      this.appendAssistantMessage(
        active.id,
        language === 'ar'
          ? `أهلًا ${displayName} 👋 أقدر أساعدك في الامتثال وإدارة الأدلة. قولّي عايز نشتغل على إيه، أو ارفع أدلة للمراجعة.`
          : `Welcome ${displayName} 👋 I can help with compliance and evidence review. Tell me what you're working on, or upload evidence for review.`,
      );
    }
  }

  private loadControlCatalog() {
    if (this.controlsLoading || this.controlsLoaded || this.controlCatalogUnavailable) return;
    if (!this.auth.user()) return;
    if (!this.canViewControlCatalog()) {
      return;
    }

    this.controlsLoading = true;
    this.apiService.listControlCatalog().subscribe({
      next: (items) => {
        this.controls = Array.isArray(items) ? items : [];
        this.controlsLoaded = true;
        this.controlsLoading = false;
        this.maybePromptAfterCatalogLoad();
      },
      error: (e) => {
        const status = Number((e as { status?: number } | null)?.status || 0);
        if (status === 403) {
          this.controlCatalogUnavailable = true;
          this.controls = [];
          this.controlsLoading = false;
          return;
        }
        console.error('control catalog error', e);
        this.controls = [];
        this.controlsLoaded = false;
        this.controlsLoading = false;
      },
    });
  }

  private canViewControlCatalog() {
    return !!this.auth.user();
  }

  private maybePromptAfterCatalogLoad() {
    if (!this.controlsLoaded) return;
    const active = this.chatService.activeConversation();
    if (!active?.controlState) return;
    const state = active.controlState;
    if (!state.intakeComplete || state.controlPrompted) return;

    const control = this.getActiveControl();
    if (!control) return;

    const nextState: ControlState = { ...state, controlPrompted: true };
    this.chatService.updateConversation(active.id, { controlState: nextState });
    void this.appendControlPrompt(active.id, control);
  }

  private async fetchControlContext(controlId: string): Promise<ControlContext | null> {
    const cached = this.controlContextCache.get(controlId);
    if (cached) return cached;

    const inflight = this.controlContextInflight.get(controlId);
    if (inflight) return inflight;

    const request = firstValueFrom(
      this.apiService.getControlContext(controlId),
    )
      .then((context) => {
        if (context) {
          this.controlContextCache.set(controlId, context);
        }
        return context;
      })
      .catch((error) => {
        console.error('control context error', error);
        return null;
      })
      .finally(() => {
        this.controlContextInflight.delete(controlId);
      });

    this.controlContextInflight.set(controlId, request);
    return request;
  }

  private applyControlAction(conversationId: string, actionId: MessageActionId) {
    const active = this.chatService.activeConversation();
    if (!active?.controlState) return;
    const state = active.controlState;
    const currentControl = this.controls[state.currentIndex];
    if (!currentControl) return;

    const status = this.mapActionToStatus(actionId);
    const nextStatuses = { ...state.statuses, [currentControl.id]: status };
    const nextIndex = this.findNextIndex(nextStatuses);
    const nextPhase = this.derivePhase(nextStatuses);

    const nextState: ControlState = {
      ...state,
      statuses: nextStatuses,
      currentIndex: nextIndex,
      phase: nextPhase,
      lastControlId: currentControl.id,
    };

    this.chatService.updateConversation(conversationId, { controlState: nextState });

    const language = this.getLanguageHint();
    const statusLabel =
      status === 'complete'
        ? language === 'ar'
          ? 'تم اعتماد الدليل'
          : 'Submitted as Evidence'
        : status === 'partial'
          ? language === 'ar'
            ? 'تم حفظه كدليل جزئي'
            : 'Submitted as Partial Evidence'
          : language === 'ar'
            ? 'تم التخطي'
            : 'Skipped';
    const phaseLabel =
      nextPhase === 'Preparation'
        ? language === 'ar'
          ? 'مرحلة الاستعداد'
          : 'Preparation'
        : nextPhase === 'Audit Ready'
          ? language === 'ar'
            ? 'جاهز للتدقيق'
            : 'Audit Ready'
          : language === 'ar'
            ? 'قيد التنفيذ'
            : 'In Progress';
    this.appendAssistantMessage(
      conversationId,
      `✅ ${currentControl.id} ${statusLabel}. ${language === 'ar' ? 'المرحلة' : 'Phase'}: ${phaseLabel}.`,
    );

    if (actionId === 'save' || actionId === 'partial') {
      this.submitEvidence(conversationId, currentControl.id, actionId === 'save' ? 'COMPLIANT' : 'PARTIAL');
    }

    const nextControl = this.controls[nextIndex];
    if (nextControl) {
      void this.appendControlPrompt(conversationId, nextControl);
    } else {
      const language = this.getLanguageHint();
      this.appendAssistantMessage(
        conversationId,
        language === 'ar'
          ? 'كل الكنترولات في النطاق ده خلصت. أنت دلوقتي جاهز للتدقيق في النطاق ده.'
          : 'All controls in this set are completed. You are Audit Ready for this scope.',
      );
    }
  }

  private async appendControlPrompt(conversationId: string, control: ControlCatalogItem) {
    const context = await this.fetchControlContext(control.id);
    if (!context) {
      const language = this.getLanguageHint();
      this.appendAssistantMessage(
        conversationId,
        language === 'ar'
          ? `تفاصيل الكنترول ${control.id} غير متاحة حالياً. جرّب تعمل تحديث وتعيد المحاولة.`
          : `Control ${control.id} details are not available right now. Please refresh and try again.`,
      );
      return;
    }

    const language = this.getLanguageHint();
    const controlLabel = language === 'ar' ? 'الكنترول' : 'Control';
    const evidenceLabel = language === 'ar' ? 'الأدلة المطلوبة' : 'Evidence needed';
    const testLabel = language === 'ar' ? 'عناصر الاختبار' : 'Test components';

    const evidenceLines = context.evidence.map((item) => `- ${item}`).join('\n');
    const testLines = context.testComponents.map((item) => `- ${item}`).join('\n');
    const summary = context.summary ? `${context.summary}\n\n` : '';
    this.appendAssistantMessage(
      conversationId,
      `${controlLabel} ${context.id} — ${context.title}\n${summary}${evidenceLabel}:\n${evidenceLines}\n\n${testLabel}:\n${testLines}`,
    );
  }

  private async evaluateEvidence(conversationId: string, control: ControlCatalogItem) {
    const payload = await this.fetchControlContext(control.id);
    if (!payload) {
      const language = this.getLanguageHint();
      this.appendAssistantMessage(
        conversationId,
        language === 'ar'
          ? 'مش قادر أحمّل تفاصيل الكنترول علشان تقييم الأدلة. جرّب مرة تانية.'
          : 'Unable to load control details for evidence review. Please try again.',
      );
      return;
    }

    const language = this.getLanguageHint();
    this.apiService.evaluateControl(conversationId, payload, language).subscribe({
      next: (res) => {
        const evaluation = res?.evaluation;
        if (!evaluation) {
          this.appendAssistantMessage(
            conversationId,
            language === 'ar'
              ? 'تقييم الأدلة رجّع نتيجة غير واضحة. جرّب مرة تانية.'
              : 'Evidence review failed to return a result.',
          );
          return;
        }
        this.chatService.clearActions(conversationId);
        const formatted = this.formatEvaluationMessage(payload, evaluation);
        this.chatService.appendMessage(conversationId, {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: formatted,
          timestamp: Date.now(),
          actions: this.getActionButtons(),
          reference: {
            type: 'kb',
            controlId: payload.id,
            title: payload.title,
            summary: payload.summary,
            evidence: payload.evidence,
            testComponents: payload.testComponents,
            label: language === 'ar' ? 'مرجع الكنترول' : 'Control reference',
          },
        });
      },
      error: (e) => {
        console.error('evidence eval error', e);
        this.appendAssistantMessage(
          conversationId,
          language === 'ar'
            ? 'مش قادر أقيّم الأدلة دلوقتي. جرّب مرة تانية.'
            : 'Unable to evaluate evidence right now. Please try again.',
        );
      },
    });
  }

  private formatEvaluationMessage(control: ControlContext, evaluation: ControlEvaluation) {
    const language = this.getLanguageHint();
    const labels =
      language === 'ar'
        ? {
            review: 'مراجعة الدليل لـ',
            status: 'الحالة',
            summary: 'الملخص',
            satisfied: 'العناصر المتحققة',
            missing: 'العناصر الناقصة',
            next: 'الخطوات المقترحة',
            sources: 'المصادر',
          }
        : {
            review: 'Evidence review for',
            status: 'Status',
            summary: 'Summary',
            satisfied: 'Satisfied test components',
            missing: 'Missing test components',
            next: 'Recommended next steps',
            sources: 'Sources',
          };
    const statusLabel =
      language === 'ar'
        ? evaluation.status === 'COMPLIANT'
          ? 'متوافق'
          : evaluation.status === 'PARTIAL'
            ? 'متوافق جزئياً'
            : evaluation.status === 'NOT_COMPLIANT'
              ? 'غير متوافق'
              : 'غير محدد'
        : evaluation.status.replace('_', ' ');
    const lines: string[] = [
      `${labels.review} ${control.id} — ${control.title}`,
      `${labels.status}: ${statusLabel}`,
      `${labels.summary}: ${evaluation.summary}`,
    ];

    if (evaluation.satisfied?.length) {
      lines.push(`${labels.satisfied}:`);
      lines.push(...evaluation.satisfied.map((item) => `- ${item}`));
    }

    if (evaluation.missing?.length) {
      lines.push(`${labels.missing}:`);
      lines.push(...evaluation.missing.map((item) => `- ${item}`));
    }

    if (evaluation.recommendations?.length) {
      lines.push(`${labels.next}:`);
      lines.push(...evaluation.recommendations.map((item) => `- ${item}`));
    }

    if (evaluation.citations?.length) {
      const docs = evaluation.citations
        .map((c) => c?.doc)
        .filter(Boolean)
        .slice(0, 3);
      if (docs.length) lines.push(`${labels.sources}: ${docs.map((d) => `[${d}]`).join(' ')}`);
    }

    return lines.join('\n');
  }

  private buildPrompt(text: string, conversationId: string) {
    const active = this.chatService.activeConversation();
    const state = active?.controlState;
    const control = state ? this.getActiveControl() : undefined;
    if (!control || !state?.intakeComplete) return text;

    const language = this.getLanguageHint();
    const details = this.controlContextCache.get(control.id);
    const title = details?.title || control.title || control.id;
    const summary = details?.summary || control.summary || '';
    const testComponents = details?.testComponents ?? [];
    const evidence = details?.evidence ?? [];
    const currentLabel = language === 'ar' ? 'الكنترول الحالي' : 'Current control';
    const testLabel = language === 'ar' ? 'عناصر الاختبار' : 'Test components';
    const evidenceLabel = language === 'ar' ? 'محور الأدلة' : 'Evidence focus';
    const contextLines = [`${currentLabel}: ${control.id} — ${title}`];
    if (summary) contextLines.push(summary);
    if (testComponents.length) contextLines.push(`${testLabel}: ${testComponents.join('; ')}`);
    if (evidence.length) contextLines.push(`${evidenceLabel}: ${evidence.join('; ')}`);
    const context = contextLines.join('\n');
    const userLabel = language === 'ar' ? 'رسالة المستخدم' : 'User message';

    return `${context}\n\n${userLabel}: ${text}`;
  }

  private maybeStartControlFlow(conversationId: string, text: string) {
    const active = this.chatService.activeConversation();
    const state = active?.controlState;
    if (!state || state.intakeComplete) return;

    if (!this.shouldStartControlFlow(text)) return;

    const shouldPrompt = !state.controlPrompted && this.controlsLoaded;
    const nextState: ControlState = {
      ...state,
      intakeComplete: true,
      controlPrompted: shouldPrompt ? true : state.controlPrompted,
    };

    this.chatService.updateConversation(conversationId, { controlState: nextState });

    if (shouldPrompt) {
      const control = this.getActiveControl();
      if (control) {
        void this.appendControlPrompt(conversationId, control);
      }
    }
  }

  private shouldStartControlFlow(text: string) {
    const value = (text || '').toLowerCase();
    if (!value) return false;

    const triggerWords = [
      'start',
      'continue',
      'resume',
      'next',
      'a.',
      'ابدأ',
      'اكمل',
      'كمل',
      'التالي',
    ];

    if (triggerWords.some((word) => value.includes(word))) return true;

    if (/control\s*(a\.\d+(\.\d+)?)/i.test(text)) return true;
    if (/كنترول\s*(\d+|\b)/i.test(value)) return true;

    return /a\.\d+(\.\d+)?/i.test(text);
  }

  private appendUploadAnalysis(
    conversationId: string,
    res: any,
    options?: { skipDocumentIds?: Set<string> },
  ) {
    const skipDocumentIds = options?.skipDocumentIds || new Set<string>();
    const docs = (Array.isArray(res?.documents) ? res.documents : []).filter((doc: any) => {
      const id = String(doc?.id || '').trim();
      return id ? !skipDocumentIds.has(id) : true;
    });
    if (!docs.length) return;

    const language = this.getLanguageHint();

    docs.forEach((doc: any) => {
      const docId = String(doc?.id || '');
      const compactContent = this.buildUploadCompactContent(doc, language);
      const actions = docId
        ? this.buildUploadCollapsedActions(docId, language, compactContent)
        : undefined;
      this.chatService.appendMessage(conversationId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: compactContent,
        timestamp: Date.now(),
        actions,
      });
    });
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

  private buildUploadCompactContent(doc: any, language: 'ar' | 'en') {
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

  private buildUploadAnalysisContent(doc: any, language: 'ar' | 'en') {
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
    const statusLabel = this.buildUploadStatusLabel(matchStatus, language);
    const note = doc?.matchNote
      ? language === 'ar'
        ? `ملاحظة: ${doc.matchNote}`
        : `AI note: ${doc.matchNote}`
      : '';
    const recs = Array.isArray(doc?.matchRecommendations) ? doc.matchRecommendations.slice(0, 3) : [];
    const frameworkRefs = Array.isArray(doc?.frameworkReferences)
      ? doc.frameworkReferences.filter(Boolean)
      : [];
    const insights = doc?.analysisJson && typeof doc.analysisJson === 'object' ? doc.analysisJson : null;
    const owner = String(insights?.governance?.owner?.value || '').trim();
    const topGap = String(insights?.gaps?.[0]?.message || '').trim();
    const topAction = String(insights?.suggestedActions?.[0]?.reason || '').trim();
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

    if (owner) {
      lines.push(language === 'ar' ? `المالك: ${owner}` : `Owner: ${owner}`);
    }
    if (topGap) {
      lines.push(language === 'ar' ? `أهم فجوة: ${topGap}` : `Top gap: ${topGap}`);
    }
    if (topAction) {
      lines.push(language === 'ar' ? `اقتراح إجراء: ${topAction}` : `Suggested action: ${topAction}`);
    }

    return lines.join('\n');
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

  private buildHideUploadDetailsAction(
    documentId: string,
    language: 'ar' | 'en',
    compactContent: string,
    expandedContent: string,
  ): MessageAction {
    return {
      id: 'hide_upload_details',
      label: language === 'ar' ? 'إخفاء التفاصيل' : 'Hide details',
      meta: {
        documentId,
        compactContent,
        expandedContent,
        uiMode: 'expanded',
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
      this.buildReevaluateAction(documentId, language, compactContent, 'collapsed'),
    ];
  }

  private buildUploadExpandedActions(
    documentId: string,
    language: 'ar' | 'en',
    compactContent: string,
    expandedContent: string,
  ): MessageAction[] {
    return [
      this.buildHideUploadDetailsAction(documentId, language, compactContent, expandedContent),
      this.buildReevaluateAction(documentId, language, compactContent, 'expanded'),
    ];
  }

  private buildReevaluateAction(
    documentId: string,
    language: 'ar' | 'en',
    compactContent?: string,
    uiMode: 'collapsed' | 'expanded' = 'collapsed',
  ): MessageAction {
    return {
      id: 'reevaluate',
      label: language === 'ar' ? 'إعادة التقييم' : 'Re-evaluate',
      meta: {
        documentId,
        compactContent,
        uiMode,
      },
    };
  }

  private handleShowUploadDetails(conversationId: string, messageId: string, action: MessageAction) {
    const documentId = action.meta?.documentId;
    if (!documentId) return;

    const language = this.getLanguageHint();
    const active = this.chatService.activeConversation();
    const existing = active?.messages.find((message) => message.id === messageId);
    const compactContent =
      String(action.meta?.compactContent || existing?.content || '').trim() ||
      (language === 'ar' ? '📎 ملف مرفوع' : '📎 Uploaded document');

    this.chatService.updateMessage(conversationId, messageId, {
      content: language === 'ar' ? '⏳ جاري تحميل التفاصيل...' : '⏳ Loading details...',
      actions: undefined,
    });

    this.apiService.getUpload(documentId).subscribe({
      next: (res: any) => {
        const doc = res?.document;
        if (!doc) {
          this.chatService.updateMessage(conversationId, messageId, {
            content: compactContent,
            actions: this.buildUploadCollapsedActions(documentId, language, compactContent),
            timestamp: Date.now(),
          });
          this.appendAssistantMessage(
            conversationId,
            language === 'ar'
              ? '❌ لا يمكن تحميل تفاصيل الملف الآن.'
              : '❌ Unable to load file details right now.',
          );
          return;
        }

        const expandedContent = this.buildUploadAnalysisContent(doc, language);
        this.chatService.updateMessage(conversationId, messageId, {
          content: expandedContent,
          actions: this.buildUploadExpandedActions(
            documentId,
            language,
            compactContent,
            expandedContent,
          ),
          timestamp: Date.now(),
        });
      },
      error: (e: unknown) => {
        console.error('show upload details error', e);
        this.chatService.updateMessage(conversationId, messageId, {
          content: compactContent,
          actions: this.buildUploadCollapsedActions(documentId, language, compactContent),
          timestamp: Date.now(),
        });
        this.appendAssistantMessage(
          conversationId,
          language === 'ar'
            ? '❌ لا يمكن تحميل تفاصيل الملف الآن.'
            : '❌ Unable to load file details right now.',
        );
      },
    });
  }

  private handleHideUploadDetails(conversationId: string, messageId: string, action: MessageAction) {
    const documentId = String(action.meta?.documentId || '').trim();
    if (!documentId) return;
    const language = this.getLanguageHint();
    const compactContent = String(action.meta?.compactContent || '').trim();
    const fallbackCompact = language === 'ar' ? '📎 ملف مرفوع' : '📎 Uploaded document';
    const nextCompactContent = compactContent || fallbackCompact;
    this.chatService.updateMessage(conversationId, messageId, {
      content: nextCompactContent,
      actions: this.buildUploadCollapsedActions(documentId, language, nextCompactContent),
      timestamp: Date.now(),
    });
  }

  private handleReevaluateAction(conversationId: string, messageId: string, action: MessageAction) {
    const documentId = action.meta?.documentId;
    if (!documentId) return;

    const language = this.getLanguageHint();
    const active = this.chatService.activeConversation();
    const existing = active?.messages.find((message) => message.id === messageId);
    const previousContent = existing?.content;
    const previousActions = existing?.actions;
    const currentMode = action.meta?.uiMode === 'expanded' ? 'expanded' : 'collapsed';

    this.chatService.updateMessage(conversationId, messageId, {
      content: language === 'ar' ? '⏳ جاري إعادة التقييم...' : '⏳ Re-evaluating document...',
      actions: undefined,
    });

    this.apiService.reevaluateUpload(documentId, language).subscribe({
      next: (res) => {
        const doc = res?.document;
        if (!doc) {
          this.chatService.updateMessage(conversationId, messageId, {
            content: previousContent || '',
            actions: previousActions,
          });
          this.appendAssistantMessage(
            conversationId,
            language === 'ar'
              ? '❌ تعذرت إعادة التقييم. جرّب مرة أخرى.'
              : '❌ Unable to re-evaluate right now. Please try again.',
          );
          return;
        }

        const compactContent = this.buildUploadCompactContent(doc, language);
        const expandedContent = this.buildUploadAnalysisContent(doc, language);
        const nextActions =
          currentMode === 'expanded'
            ? this.buildUploadExpandedActions(documentId, language, compactContent, expandedContent)
            : this.buildUploadCollapsedActions(documentId, language, compactContent);
        this.chatService.updateMessage(conversationId, messageId, {
          content: currentMode === 'expanded' ? expandedContent : compactContent,
          actions: nextActions,
          timestamp: Date.now(),
        });
      },
      error: (e) => {
        console.error('reevaluate error', e);
        this.chatService.updateMessage(conversationId, messageId, {
          content: previousContent || '',
          actions: previousActions,
        });
        this.appendAssistantMessage(
          conversationId,
          language === 'ar'
            ? '❌ تعذرت إعادة التقييم. جرّب مرة أخرى.'
            : '❌ Unable to re-evaluate right now. Please try again.',
        );
      },
    });
  }

  private mapActionToStatus(actionId: MessageActionId): ControlStatus {
    if (actionId === 'save') return 'complete';
    if (actionId === 'partial') return 'partial';
    if (actionId === 'skip') return 'skipped';
    return 'pending';
  }

  private submitEvidence(conversationId: string, controlId: string, status: 'COMPLIANT' | 'PARTIAL') {
    const active = this.chatService.activeConversation();
    const docIds = active?.lastUploadIds ?? [];
    if (!docIds.length) {
      const language = this.getLanguageHint();
      this.appendAssistantMessage(
        conversationId,
        language === 'ar'
          ? 'مفيش ملفات مرفوعة حديثًا علشان نثبتها. ارفع الأدلة أولًا وبعدين اعمل Submit.'
          : 'No recent upload found to submit. Upload evidence first, then submit it for this control.',
      );
      return;
    }

    this.apiService.submitEvidence(docIds, controlId, status).subscribe({
      next: (res) => {
        if (res?.ok) {
          this.chatService.updateConversation(conversationId, { lastUploadIds: [], lastUploadAt: undefined });
        }
      },
      error: () => {
        const language = this.getLanguageHint();
        this.appendAssistantMessage(
          conversationId,
          language === 'ar'
            ? 'مش قادر أثبّت الدليل دلوقتي. جرّب مرة تانية.'
            : 'Unable to submit evidence right now. Please try again.',
        );
      },
    });
  }

  private findNextIndex(statuses: Record<string, ControlStatus>) {
    for (let i = 0; i < this.controls.length; i++) {
      const id = this.controls[i].id;
      if (!statuses[id]) return i;
    }
    return this.controls.length;
  }

  private derivePhase(statuses: Record<string, ControlStatus>) {
    const values = Object.values(statuses);
    if (!values.length) return 'Preparation';
    if (values.length >= this.controls.length) return 'Audit Ready';
    return 'In Progress';
  }
}
