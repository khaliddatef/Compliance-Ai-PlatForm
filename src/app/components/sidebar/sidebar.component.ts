import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Router } from '@angular/router';
import { Conversation } from '../../models/conversation.model';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css'
})
export class SidebarComponent {
  @Input() open = true;
  @Output() closeSidebar = new EventEmitter<void>();

  constructor(
    private readonly chatService: ChatService,
    private readonly router: Router
  ) {}

  get conversations() {
    return this.chatService.conversations();
  }

  get activeId() {
    return this.chatService.activeConversationId();
  }

  trackConversation(_index: number, conversation: Conversation) {
    return conversation.id;
  }

  startNewChat() {
    const conversation = this.chatService.startNewConversation();
    this.router.navigate(['/']);
    return conversation;
  }

  selectConversation(conversation: Conversation) {
    this.chatService.selectConversation(conversation.id);
    this.router.navigate(['/']);
  }
}
