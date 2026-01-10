import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { Message } from '../../models/message.model';
import { MessageBubbleComponent } from '../message-bubble/message-bubble.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [CommonModule, MessageBubbleComponent],
  templateUrl: './message-list.component.html',
  styleUrl: './message-list.component.css'
})
export class MessageListComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() messages: Message[] = [];
  @Input() typing = false;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLDivElement>;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit() {
    this.scrollToBottom();
    this.observeResize();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['messages'] || changes['typing']) {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => this.scrollToBottom());
      }
    }
  }

  trackById(_index: number, message: Message) {
    return message.id;
  }

  private observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;

    this.resizeObserver = new ResizeObserver(() => this.scrollToBottom());
    this.resizeObserver.observe(el);
  }

  private scrollToBottom() {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
