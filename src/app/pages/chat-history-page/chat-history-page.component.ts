import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
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
  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 20, 50];

  constructor(
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadRemoteConversations();
  }

  get isPrivileged() {
    const role = (this.auth.user()?.role || 'USER').toUpperCase();
    return role === 'ADMIN' || role === 'MANAGER';
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

  get totalItems() {
    return this.filteredRemoteConversations.length;
  }

  get totalPages() {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get pagedRemoteConversations(): ChatConversationSummary[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRemoteConversations.slice(start, start + this.pageSize);
  }

  get showingFrom() {
    if (!this.totalItems) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get showingTo() {
    if (!this.totalItems) return 0;
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  get pageNumbers() {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) return Array.from({ length: total }, (_, idx) => idx + 1);

    const start = Math.max(1, current - 2);
    const end = Math.min(total, start + 4);
    const normalizedStart = Math.max(1, end - 4);
    return Array.from({ length: end - normalizedStart + 1 }, (_, idx) => normalizedStart + idx);
  }

  openRemoteConversation(conversationId: string) {
    if (this.isPrivileged) {
      this.router.navigate(['/history', conversationId]);
    } else {
      this.router.navigate(['/home'], { queryParams: { conversationId } });
    }
  }

  getRemoteTitle(conversation: ChatConversationSummary) {
    const rawTitle = String(conversation?.title || '').trim();
    const preferred = rawTitle && rawTitle !== 'New compliance chat' ? rawTitle : '';
    const fallback = String(conversation?.lastMessage || '').trim();
    const source = preferred || fallback;
    return this.formatTitle(source) || 'Untitled chat';
  }

  deleteRemoteConversation(conversationId: string, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm('Delete this conversation?')) return;
    this.api.deleteConversation(conversationId).subscribe({
      next: () => {
        this.remoteConversations = this.remoteConversations.filter((item) => item.id !== conversationId);
        this.ensureValidPage();
        this.cdr.markForCheck();
      },
      error: () => {
        this.remoteError = 'Unable to delete conversation.';
        this.cdr.markForCheck();
      },
    });
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

  trackByRemoteId(_index: number, conversation: ChatConversationSummary) {
    return conversation.id;
  }

  onSearchChange() {
    this.currentPage = 1;
  }

  prevPage() {
    if (this.currentPage <= 1) return;
    this.currentPage -= 1;
  }

  nextPage() {
    if (this.currentPage >= this.totalPages) return;
    this.currentPage += 1;
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  updatePageSize(value: string | number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    this.pageSize = parsed;
    this.currentPage = 1;
  }

  getRowNumber(index: number) {
    return (this.currentPage - 1) * this.pageSize + index + 1;
  }

  private loadRemoteConversations() {
    this.remoteLoading = true;
    this.remoteError = '';
    this.cdr.markForCheck();

    this.api.listChatConversations().subscribe({
      next: (items) => {
        this.remoteConversations = Array.isArray(items) ? items : [];
        this.ensureValidPage();
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

  private ensureValidPage() {
    const total = this.totalPages;
    if (this.currentPage > total) {
      this.currentPage = total;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }
}
