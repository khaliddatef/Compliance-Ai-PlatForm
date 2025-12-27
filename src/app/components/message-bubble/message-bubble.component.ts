import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Message } from '../../models/message.model';

type RenderLine = {
  type: 'bullet' | 'text';
  parts: { text: string; citation: boolean }[];
};

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.css'
})
export class MessageBubbleComponent {
  @Input({ required: true }) message!: Message;

  copied = false;
  feedback: 'up' | 'down' | '' = '';

  get lines(): RenderLine[] {
    if (!this.message?.content) return [];
    return this.message.content
      .split('\n')
      .filter((line) => line.trim().length)
      .map((line) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*');
        const text = isBullet ? trimmed.replace(/^[-*]\s*/, '') : trimmed;
        return {
          type: isBullet ? 'bullet' : 'text',
          parts: this.parseCitations(text)
        };
      });
  }

  copyContent() {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(this.message.content).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    });
  }

  setFeedback(direction: 'up' | 'down') {
    this.feedback = this.feedback === direction ? '' : direction;
  }

  private parseCitations(text: string) {
    const parts: { text: string; citation: boolean }[] = [];
    const citationPattern = /\[([^\]]+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationPattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ text: text.slice(lastIndex, match.index), citation: false });
      }
      parts.push({ text: `[${match[1]}]`, citation: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push({ text: text.slice(lastIndex), citation: false });
    }

    return parts.length ? parts : [{ text, citation: false }];
  }
}
