import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ChatService } from '../../services/chat.service';
import { Conversation } from '../../models/conversation.model';
import { ApiService, ChatConversationSummary } from '../../services/api.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat-history-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-history-page.component.html',
  styleUrl: './chat-history-page.component.css'
})
export class ChatHistoryPageComponent implements OnInit {
  searchTerm = '';
  remoteConversations: ChatConversationSummary[] = [];
  remoteLoading = false;
  remoteError = '';

  constructor(
    private readonly chat: ChatService,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    if (this.isPrivileged) {
      this.loadRemoteConversations();
    }
  }

  get isPrivileged() {
    const role = (this.auth.user()?.role || 'USER').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
  }

  get localConversations(): Conversation[] {
    const list = [...this.chat.conversations()].sort((a, b) => b.updatedAt - a.updatedAt);
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return list;

    return list.filter((conversation) => {
      const lastMessage = conversation.messages[conversation.messages.length - 1]?.content || '';
      const haystack = `${conversation.title} ${lastMessage}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  get filteredRemoteConversations(): ChatConversationSummary[] {
    const list = [...this.remoteConversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return list;

    return list.filter((conversation) => {
      const userName = conversation.user?.name || '';
      const userEmail = conversation.user?.email || '';
      const lastMessage = conversation.lastMessage || '';
      const haystack = `${conversation.title} ${userName} ${userEmail} ${lastMessage}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  openConversation(conversationId: string) {
    this.chat.selectConversation(conversationId);
    this.router.navigate(['/home'], { queryParams: { conversationId } });
  }

  openRemoteConversation(conversationId: string) {
    this.router.navigate(['/history', conversationId]);
  }

  deleteConversation(conversationId: string, event: MouseEvent) {
    event.stopPropagation();
    this.chat.removeConversation(conversationId);
  }

  trackById(_index: number, conversation: Conversation) {
    return conversation.id;
  }

  trackByRemoteId(_index: number, conversation: ChatConversationSummary) {
    return conversation.id;
  }

  private loadRemoteConversations() {
    this.remoteLoading = true;
    this.remoteError = '';
    this.cdr.markForCheck();

    this.api.listChatConversations().subscribe({
      next: (items) => {
        this.remoteConversations = Array.isArray(items) ? items : [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.remoteError = 'Unable to load chat history.';
        this.remoteLoading = false;
        this.cdr.markForCheck();
      },
      complete: () => {
        this.remoteLoading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
