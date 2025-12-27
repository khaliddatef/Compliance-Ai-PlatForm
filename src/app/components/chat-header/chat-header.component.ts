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
  @Input() subtitle = 'Aligned to ISO and FRA standards';
  @Input() status = 'Live';
  @Input() showSummaryButton = false;
  @Input() showMenuButton = false;
  @Output() menuToggle = new EventEmitter<void>();
  @Output() summaryToggle = new EventEmitter<void>();
}
