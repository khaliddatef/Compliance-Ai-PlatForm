import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { Message, MessageAction, MessageActionId } from '../../models/message.model';
import { ApiService, ComplianceStandard, ChatApiResponse } from '../../services/api.service';
import { ChatService } from '../../services/chat.service';
import { ChatHeaderComponent } from '../../components/chat-header/chat-header.component';
import { ComposerComponent, ComposerSendPayload } from '../../components/composer/composer.component';
import { MessageListComponent } from '../../components/message-list/message-list.component';
import { AuthService } from '../../services/auth.service';
import { ISO_CONTROLS, IsoControl } from '../../data/iso-controls';
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

  selectedStandard: ComplianceStandard = 'ISO';

  private readonly controls = ISO_CONTROLS;
  private readonly actionButtons: MessageAction[] = [
    { id: 'save', label: 'Save as Evidence' },
    { id: 'partial', label: 'Save as Partial Evidence' },
    { id: 'fix', label: 'Ask how to fix missing requirements' },
    { id: 'skip', label: 'Skip for now' },
  ];

  private routeSub?: Subscription;

  constructor(
    private readonly chatService: ChatService,
    private readonly apiService: ApiService,
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const conversationId = params.get('conversationId');

      if (conversationId) {
        const exists = this.chatService.conversations().some((c) => c.id === conversationId);
        if (exists) {
          this.chatService.selectConversation(conversationId);
        } else {
          this.chatService.startNewConversation();
        }
      } else {
        this.chatService.startNewConversation();
      }

      this.ensureControlFlow();
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

  handleComposerSend(payload: ComposerSendPayload) {
    const text = (payload?.text ?? '').trim();
    const files = payload?.files ?? [];

    if (!text && files.length === 0) return;

    const active = this.chatService.activeConversation() || this.chatService.startNewConversation();

    // ✅ ارفع الأول (عشان يبقى available في RAG)
    if (files.length) {
      this.uploadDocs(files, active.id);
    }

    if (text) {
      this.sendMessage(text, active.id);
    }
  }

  handleActionSelected(event: { messageId: string; action: MessageAction }) {
    const active = this.chatService.activeConversation();
    if (!active) return;

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

    const prompt = this.buildPrompt(text, conversationId);
    this.apiService.sendMessage(prompt, this.selectedStandard, conversationId).subscribe({
      next: (raw: ChatApiResponse) => {
        const replyText = String(raw?.reply ?? raw?.assistantMessage ?? '');

        if (options.showActions !== false) {
          this.chatService.clearActions(conversationId);
        }

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: replyText || 'No reply.',
          timestamp: Date.now(),
          actions: options.showActions === false ? undefined : this.actionButtons,
        };

        this.chatService.appendMessage(conversationId, assistantMessage);

      },
      error: (e) => {
        console.error('chat error', e);
        const fallback: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Unable to reach the assistant right now. Please try again.',
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

  private uploadDocs(files: File[], conversationId: string) {
    const summaryText = this.buildUploadSummary(files);
    this.chatService.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: summaryText,
      timestamp: Date.now(),
    });

    this.uploading = true;
    this.uploadProgress = 10;

    // ✅ دي اللي شغالة فعلاً في ApiService
    this.apiService.uploadCustomerFiles(conversationId, this.selectedStandard, files).subscribe({
      next: (res: any) => {
        // backend بيرجع ingestResults وعدد chunks.. إلخ
        const ok = !!res?.ok;
        const count = Number(res?.count ?? files.length);

        const ingestOk = Array.isArray(res?.ingestResults)
          ? res.ingestResults.filter((x: any) => x?.ok).length
          : undefined;

        const msg = ok
          ? `✅ Uploaded ${count} file(s) successfully${typeof ingestOk === 'number' ? ` (ingested: ${ingestOk}/${count})` : ''}.`
          : `⚠️ Upload finished but response is unexpected.`;

        this.appendAssistantMessage(conversationId, msg);
        this.uploadProgress = 100;
      },
      error: (e) => {
        console.error('upload error', e);
        this.appendAssistantMessage(conversationId, '❌ Upload failed. Please try again.');
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
    const prompts: Record<MessageActionId, string> = {
      save:
        'User chose: Save as Evidence. Confirm it is saved and tell the user the next control to work on.',
      partial:
        'User chose: Save as Partial Evidence. Confirm partial status and list missing items to complete.',
      fix:
        'User asked for remediation guidance. Provide concise steps to fix missing requirements.',
      skip:
        'User chose: Skip for now. Confirm skip and guide to the next control.',
    };
    return prompts[actionId];
  }

  private buildUploadSummary(files: File[]) {
    const names = files.map((f) => f.name);
    const shortList = names.length > 2 ? `${names.slice(0, 2).join(', ')}…` : names.join(', ');
    return `Uploaded ${names.length} ${names.length === 1 ? 'document' : 'documents'}: ${shortList}`;
  }

  private getUserName() {
    const rawName = this.auth.user()?.name?.trim();
    return rawName && rawName.length ? rawName : null;
  }

  private ensureControlFlow() {
    const active = this.chatService.activeConversation() || this.chatService.startNewConversation();
    const name = this.getUserName();
    const currentState = active.controlState;
    if (currentState?.started) {
      if (name && currentState.greetedName !== name) {
        this.chatService.updateConversation(active.id, {
          controlState: { ...currentState, greetedName: name },
        });
        this.appendAssistantMessage(active.id, `Welcome back ${name} 👋`);
      }
      return;
    }

    const initialState: ControlState = {
      started: true,
      currentIndex: 0,
      statuses: {},
      phase: 'Preparation',
      greetedName: name ?? undefined,
    };
    this.chatService.updateConversation(active.id, { controlState: initialState });

    const displayName = name || 'there';
    const control = this.controls[0];
    const lastControlText = control ? `The next control is ${control.id}.` : '';

    this.appendAssistantMessage(
      active.id,
      `Welcome ${displayName} 👋 You are preparing for ISO/IEC 27001 compliance. ${lastControlText} Would you like to continue?`,
    );

    if (control) {
      this.appendControlPrompt(active.id, control);
    }
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

    const statusLabel =
      status === 'complete' ? 'Saved as Evidence' : status === 'partial' ? 'Saved as Partial Evidence' : 'Skipped';
    this.appendAssistantMessage(
      conversationId,
      `✅ ${currentControl.id} ${statusLabel}. Phase: ${nextPhase}.`,
    );

    const nextControl = this.controls[nextIndex];
    if (nextControl) {
      this.appendControlPrompt(conversationId, nextControl);
    } else {
      this.appendAssistantMessage(
        conversationId,
        'All controls in this set are completed. You are Audit Ready for this scope.',
      );
    }
  }

  private appendControlPrompt(conversationId: string, control: IsoControl) {
    const evidenceLines = control.evidence.map((item) => `- ${item}`).join('\n');
    const testLines = control.testComponents.map((item) => `- ${item}`).join('\n');
    this.appendAssistantMessage(
      conversationId,
      `Control ${control.id} — ${control.title}\n${control.summary}\n\nEvidence needed:\n${evidenceLines}\n\nTest components:\n${testLines}`,
    );
  }

  private buildPrompt(text: string, conversationId: string) {
    const active = this.chatService.activeConversation();
    const state = active?.controlState;
    const control = state ? this.controls[state.currentIndex] : undefined;
    if (!control) return text;

    const context = [
      `Current control: ${control.id} — ${control.title}`,
      `Test components: ${control.testComponents.join('; ')}`,
      `Evidence focus: ${control.evidence.join('; ')}`,
    ].join('\n');

    return `${context}\n\nUser message: ${text}`;
  }

  private mapActionToStatus(actionId: MessageActionId): ControlStatus {
    if (actionId === 'save') return 'complete';
    if (actionId === 'partial') return 'partial';
    if (actionId === 'skip') return 'skipped';
    return 'pending';
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
