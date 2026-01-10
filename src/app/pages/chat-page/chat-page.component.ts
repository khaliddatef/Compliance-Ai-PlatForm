import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Message } from '../../models/message.model';
import { ApiService, ComplianceStandard, ChatApiResponse } from '../../services/api.service';
import { ChatService } from '../../services/chat.service';
import { ChatHeaderComponent } from '../../components/chat-header/chat-header.component';
import { ComposerComponent, ComposerSendPayload } from '../../components/composer/composer.component';
import { MessageListComponent } from '../../components/message-list/message-list.component';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [CommonModule, ChatHeaderComponent, ComposerComponent, MessageListComponent],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {
  typing = false;
  uploading = false;
  uploadProgress = 0;
  attachmentResetKey = 0;

  selectedStandard: ComplianceStandard = 'ISO';

  constructor(
    private readonly chatService: ChatService,
    private readonly apiService: ApiService
  ) {}

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

  private sendMessage(text: string, conversationId: string) {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    this.chatService.appendMessage(conversationId, userMessage);
    this.typing = true;

    this.apiService.sendMessage(text, this.selectedStandard, conversationId).subscribe({
      next: (raw: ChatApiResponse) => {
        const replyText = String(raw?.reply ?? raw?.assistantMessage ?? '');

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: replyText || 'No reply.',
          timestamp: Date.now(),
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

  private buildUploadSummary(files: File[]) {
    const names = files.map((f) => f.name);
    const shortList = names.length > 2 ? `${names.slice(0, 2).join(', ')}…` : names.join(', ');
    return `Uploaded ${names.length} ${names.length === 1 ? 'document' : 'documents'}: ${shortList}`;
  }
}
