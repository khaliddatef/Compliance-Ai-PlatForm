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
  private readonly isBrowser = typeof window !== 'undefined';
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit() {
    if (!this.isBrowser) return;
    this.scrollToBottom();
    this.observeResize();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.isBrowser) return;
    if (changes['messages'] || changes['typing']) {
      const raf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (fn: FrameRequestCallback) => setTimeout(fn);
      raf(() => this.scrollToBottom());
    }
  }

  trackById(_index: number, message: Message) {
    return message.id;
  }

  private observeResize() {
    if (!this.isBrowser || typeof ResizeObserver === 'undefined') return;
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
