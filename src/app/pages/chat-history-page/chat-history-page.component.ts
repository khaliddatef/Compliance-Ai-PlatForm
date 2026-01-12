import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ChatService } from '../../services/chat.service';
import { Conversation } from '../../models/conversation.model';

@Component({
  selector: 'app-chat-history-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-history-page.component.html',
  styleUrl: './chat-history-page.component.css'
})
export class ChatHistoryPageComponent {
  searchTerm = '';

  constructor(private readonly chat: ChatService, private readonly router: Router) {}

  get conversations(): Conversation[] {
    const list = [...this.chat.conversations()].sort((a, b) => b.updatedAt - a.updatedAt);
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return list;

    return list.filter((conversation) => {
      const lastMessage = conversation.messages[conversation.messages.length - 1]?.content || '';
      const haystack = `${conversation.title} ${lastMessage}`.toLowerCase();
      return haystack.includes(term);
    });
  }

  openConversation(conversationId: string) {
    this.chat.selectConversation(conversationId);
    this.router.navigate(['/home'], { queryParams: { conversationId } });
  }

  deleteConversation(conversationId: string, event: MouseEvent) {
    event.stopPropagation();
    this.chat.removeConversation(conversationId);
  }

  trackById(_index: number, conversation: Conversation) {
    return conversation.id;
  }
}
