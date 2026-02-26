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
import { ComposerComponent, ComposerSendPayload } from '../../components/composer/composer.component';
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
            this.chatService.startNewConversation();
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

      this.chatService.startNewConversation();
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

  startNewChat() {
    this.chatService.startNewConversation();
    this.router.navigate(['/home'], { replaceUrl: true });
    this.ensureControlFlow();
    this.maybePromptAfterCatalogLoad();
  }

  handleComposerSend(payload: ComposerSendPayload) {
    const text = (payload?.text ?? '').trim();
    const files = payload?.files ?? [];

    if (!text && files.length === 0) return;

    const active = this.chatService.activeConversation() || this.chatService.startNewConversation();

    // ✅ ارفع الأول (عشان يبقى available في RAG)
    if (files.length) {
      const deferredText = text || undefined;
      this.uploadDocs(files, active.id, deferredText);
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
      this.sendMessage(text, active.id);
    }
  }

  handleActionSelected(event: { messageId: string; action: MessageAction }) {
    const active = this.chatService.activeConversation();
    if (!active) return;

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
    options: { showActions?: boolean; hideUserMessage?: boolean } = {},
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
    this.apiService.sendMessage(prompt, conversationId, language).subscribe({
      next: (raw: ChatApiResponse) => {
        const replyText = String(raw?.reply ?? raw?.assistantMessage ?? '');
        const externalLinks = Array.isArray(raw?.externalLinks) ? raw.externalLinks : [];
        const firstLink = externalLinks[0];
        const reference = firstLink
          ? {
              type: 'link' as const,
              label: language === 'ar' ? 'مصدر' : 'Source',
              url: firstLink.url,
            }
          : undefined;

        if (showActions !== false) {
          this.chatService.clearActions(conversationId);
        }

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            replyText ||
            (language === 'ar' ? 'لا يوجد رد في الوقت الحالي.' : 'No reply.'),
          timestamp: Date.now(),
          actions: showActions === false ? undefined : this.getActionButtons(),
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

  private uploadDocs(files: File[], conversationId: string, deferredText?: string) {
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

        const ingestOk = Array.isArray(res?.ingestResults)
          ? res.ingestResults.filter((x: any) => x?.ok).length
          : undefined;

        const msg = ok
          ? language === 'ar'
            ? `✅ تم رفع ${count} ملف${count === 1 ? '' : 'ات'} بنجاح${typeof ingestOk === 'number' ? ` (تمت المعالجة: ${ingestOk}/${count})` : ''}.`
            : `✅ Uploaded ${count} file(s) successfully${typeof ingestOk === 'number' ? ` (ingested: ${ingestOk}/${count})` : ''}.`
          : language === 'ar'
            ? '⚠️ الرفع تم لكن الرد غير متوقع.'
            : `⚠️ Upload finished but response is unexpected.`;

        this.appendAssistantMessage(conversationId, msg);

        const uploadedDocs = Array.isArray(res?.documents) ? res.documents : [];
        if (uploadedDocs.length) {
          const docIds = uploadedDocs.map((doc: any) => String(doc.id)).filter(Boolean);
          this.chatService.updateConversation(conversationId, {
            lastUploadIds: docIds,
            lastUploadAt: Date.now(),
          });
        }

        this.appendUploadAnalysis(conversationId, res);

        const control = this.getActiveControl();
        if (control && this.isControlFlowActive()) {
          void this.evaluateEvidence(conversationId, control);
        }
        if (ok && deferredText) {
          this.sendMessage(deferredText, conversationId, { hideUserMessage: true });
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
    const active = this.chatService.activeConversation() || this.chatService.startNewConversation();
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
            assessment: 'التقييم التفصيلي',
            noAssessment: 'لا توجد تفاصيل إضافية من التقييم.',
            satisfied: 'العناصر المتحققة',
            noSatisfied: 'لم يتضح تحقق عناصر بشكل كافٍ حتى الآن.',
            missing: 'العناصر الناقصة',
            noMissing: 'لا توجد عناصر ناقصة مذكورة.',
            next: 'الخطوات المقترحة',
            noNext: 'لا توجد خطوات إضافية مقترحة حالياً.',
            sources: 'المصادر',
          }
        : {
            review: 'Evidence review for',
            status: 'Status',
            assessment: 'Detailed assessment',
            noAssessment: 'No additional assessment details were provided.',
            satisfied: 'Satisfied test components',
            noSatisfied: 'No components are clearly satisfied yet.',
            missing: 'Missing test components',
            noMissing: 'No missing components were listed.',
            next: 'Recommended next steps',
            noNext: 'No additional next steps were provided.',
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
    const summaryLines = String(evaluation.summary || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const lines: string[] = [
      `${labels.review} ${control.id} — ${control.title}`,
      `${labels.status}: ${statusLabel}`,
      `${labels.assessment}:`,
    ];

    if (summaryLines.length) {
      lines.push(
        ...summaryLines.map((line) => (line.startsWith('-') ? line : `- ${line}`)),
      );
    } else {
      lines.push(`- ${labels.noAssessment}`);
    }

    lines.push(`${labels.satisfied}:`);
    if (evaluation.satisfied?.length) {
      lines.push(...evaluation.satisfied.map((item) => `- ${item}`));
    } else {
      lines.push(`- ${labels.noSatisfied}`);
    }

    lines.push(`${labels.missing}:`);
    if (evaluation.missing?.length) {
      lines.push(...evaluation.missing.map((item) => `- ${item}`));
    } else {
      lines.push(`- ${labels.noMissing}`);
    }

    lines.push(`${labels.next}:`);
    if (evaluation.recommendations?.length) {
      lines.push(...evaluation.recommendations.map((item) => `- ${item}`));
    } else {
      lines.push(`- ${labels.noNext}`);
    }

    if (evaluation.citations?.length) {
      const docs = Array.from(
        new Set(
          evaluation.citations
            .map((citation) => {
              const doc = String(citation?.doc || '').trim();
              if (!doc) return '';
              const page = citation?.page;
              return typeof page === 'number' && Number.isFinite(page)
                ? `${doc} (p. ${page})`
                : doc;
            })
            .filter(Boolean),
        ),
      ).slice(0, 5);

      if (docs.length) {
        lines.push(`${labels.sources}:`);
        lines.push(...docs.map((doc) => `- [${doc}]`));
      }
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

  private appendUploadAnalysis(conversationId: string, res: any) {
    const docs = Array.isArray(res?.documents) ? res.documents : [];
    if (!docs.length) return;

    const language = this.getLanguageHint();

    docs.forEach((doc: any) => {
      const content = this.buildUploadAnalysisContent(doc, language);
      const docId = String(doc?.id || '');
      const actions = docId ? [this.buildReevaluateAction(docId, language)] : undefined;
      this.chatService.appendMessage(conversationId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content,
        timestamp: Date.now(),
        actions,
      });
    });
  }

  private buildUploadAnalysisContent(doc: any, language: 'ar' | 'en') {
    const fallbackName = language === 'ar' ? 'ملف مرفوع' : 'Uploaded document';
    const fileName = doc?.originalName || fallbackName;
    const docType = String(doc?.docType || '').trim();
    const noCandidateControl = this.isNoCandidateControl(doc);
    const controlValue = String(doc?.matchControlId || doc?.matchControlTitle || '').trim();
    const controlLabel = controlValue
      ? controlValue
      : noCandidateControl
        ? language === 'ar'
          ? 'لم يتم العثور على Candidate Control'
          : 'No candidate control found'
        : language === 'ar'
          ? 'غير محدد'
          : 'Not identified';

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

    const noteLines = String(doc?.matchNote || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const recs = Array.isArray(doc?.matchRecommendations) ? doc.matchRecommendations.slice(0, 5) : [];
    const frameworkRefs = Array.isArray(doc?.frameworkReferences)
      ? doc.frameworkReferences.filter(Boolean)
      : [];

    const labels =
      language === 'ar'
        ? {
            analysis: 'تحليل الملف',
            type: 'النوع',
            control: 'الكنترول',
            status: 'الحالة',
            assessment: 'تفاصيل التقييم',
            noAssessment: 'لا توجد ملاحظات تفصيلية متاحة.',
            refs: 'مراجع الفريمووركات',
            next: 'الخطوات المقترحة',
            noNext: 'لا توجد خطوات إضافية حالياً.',
          }
        : {
            analysis: 'Document analysis',
            type: 'Type',
            control: 'Control',
            status: 'Status',
            assessment: 'Assessment details',
            noAssessment: 'No detailed assessment notes are available.',
            refs: 'Framework references',
            next: 'Recommended next steps',
            noNext: 'No additional next steps were provided.',
          };

    const lines = [
      `📎 ${fileName}`,
      `${labels.analysis}:`,
      `- ${labels.type}: ${docType || (language === 'ar' ? 'غير محدد' : 'Not identified')}`,
      `- ${labels.control}: ${controlLabel}`,
      `- ${labels.status}: ${statusLabel}`,
      `${labels.assessment}:`,
    ];

    if (noteLines.length) {
      lines.push(...noteLines.map((line) => (line.startsWith('-') ? line : `- ${line}`)));
    } else {
      lines.push(`- ${labels.noAssessment}`);
    }

    if (frameworkRefs.length) {
      lines.push(`${labels.refs}:`);
      lines.push(...frameworkRefs.map((item: string) => `- ${item}`));
    }

    lines.push(`${labels.next}:`);
    if (recs.length) {
      lines.push(...recs.map((item: string) => `- ${item}`));
    } else {
      lines.push(`- ${labels.noNext}`);
    }

    return lines.join('\n');
  }

  private isNoCandidateControl(doc: any) {
    if (String(doc?.matchControlId || '').trim()) return false;
    const note = String(doc?.matchNote || '').toLowerCase();
    return (
      note.includes('no candidate control found') ||
      note.includes('\u0644\u0645 \u064A\u062A\u0645 \u0627\u0644\u0639\u062B\u0648\u0631 \u0639\u0644\u0649 candidate control')
    );
  }

  private buildReevaluateAction(documentId: string, language: 'ar' | 'en'): MessageAction {
    return {
      id: 'reevaluate',
      label: language === 'ar' ? 'إعادة التقييم' : 'Re-evaluate',
      meta: { documentId },
    };
  }

  private handleReevaluateAction(conversationId: string, messageId: string, action: MessageAction) {
    const documentId = action.meta?.documentId;
    if (!documentId) return;

    const language = this.getLanguageHint();
    const active = this.chatService.activeConversation();
    const existing = active?.messages.find((message) => message.id === messageId);
    const previousContent = existing?.content;
    const previousActions = existing?.actions;

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

        const content = this.buildUploadAnalysisContent(doc, language);
        this.chatService.updateMessage(conversationId, messageId, {
          content,
          actions: [this.buildReevaluateAction(documentId, language)],
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
