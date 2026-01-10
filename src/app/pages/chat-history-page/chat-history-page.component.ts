import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ChatService } from '../../services/chat.service';
import { Conversation } from '../../models/conversation.model';

@Component({
  selector: 'app-chat-history-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-history-page.component.html',
  styleUrl: './chat-history-page.component.css'
})
export class ChatHistoryPageComponent {
  constructor(private readonly chat: ChatService, private readonly router: Router) {}

  get conversations(): Conversation[] {
    return this.chat.conversations();
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
