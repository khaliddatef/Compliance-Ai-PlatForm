import { CommonModule } from '@angular/common';
import { Component, Input, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { Message } from '../../models/message.model';
import { MessageBubbleComponent } from '../message-bubble/message-bubble.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule, MessageBubbleComponent],
  templateUrl: './message-list.component.html',
  styleUrl: './message-list.component.css'
})
export class MessageListComponent implements AfterViewInit, OnChanges {
  @Input() messages: Message[] = [];
  @Input() typing = false;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;

  ngAfterViewInit() {
    this.scrollToBottom();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['typing']) {
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  trackById(_index: number, message: Message) {
    return message.id;
  }

  private scrollToBottom() {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
