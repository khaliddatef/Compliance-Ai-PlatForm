import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.css'
})
export class ChatHeaderComponent {
  @Input() title = 'Compliance workspace';
  @Input() subtitle = '';
  @Input() status = 'Live';
  @Input() showAction = false;
  @Input() actionLabel = 'New chat';
  @Output() actionClicked = new EventEmitter<void>();
}
