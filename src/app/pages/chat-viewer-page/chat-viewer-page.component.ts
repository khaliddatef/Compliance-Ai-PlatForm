import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { Message } from '../../models/message.model';
import { ApiService, ChatConversationSummary, ChatMessageRecord } from '../../services/api.service';
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
    }).subscribe({
      next: ({ meta, messages }) => {
        this.title = meta?.title || 'Chat';
        this.subtitle = this.buildSubtitle(meta);
        this.messages = this.mapMessages(messages);
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
}
