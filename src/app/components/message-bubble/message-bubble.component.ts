import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Message, MessageAction, MessageReference } from '../../models/message.model';

type RenderLine = {
  type: 'bullet' | 'text' | 'option';
  optionIndex?: string;
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
  @Output() actionSelected = new EventEmitter<{ messageId: string; action: MessageAction }>();
  copied = false;
  feedback: 'up' | 'down' | '' = '';
  menuOpen = false;
  reading = false;
  referenceOpen = false;

  get lines(): RenderLine[] {
    if (!this.message?.content) return [];
    return this.message.content
      .split('\n')
      .filter((line) => line.trim().length)
      .map((line) => {
        const trimmed = line.trim();
        const optionMatch = trimmed.match(/^(\d+)[).\-]\s*(.+)$/);
        if (optionMatch) {
          return {
            type: 'option' as const,
            optionIndex: optionMatch[1],
            parts: this.parseCitations(optionMatch[2]),
          };
        }
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

  shareMessage() {
    const text = this.message.content || '';
    const share = (navigator as any)?.share;
    if (typeof share === 'function') {
      share({ text }).catch(() => {});
      return;
    }
    this.copyContent();
  }

  toggleMenu() {
    this.menuOpen = !this.menuOpen;
  }

  toggleReference() {
    if (this.reference?.type === 'link') {
      if (typeof window !== 'undefined') {
        window.open(this.reference.url, '_blank', 'noopener');
      }
      return;
    }
    this.referenceOpen = !this.referenceOpen;
  }

  closeReference() {
    this.referenceOpen = false;
  }

  readAloud() {
    this.menuOpen = false;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const synth = window.speechSynthesis;
    if (this.reading) {
      synth.cancel();
      this.reading = false;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(this.message.content || '');
    utterance.onend = () => {
      this.reading = false;
    };
    utterance.onerror = () => {
      this.reading = false;
    };
    synth.cancel();
    synth.speak(utterance);
    this.reading = true;
  }

  reportMessage() {
    this.menuOpen = false;
    console.info('Report message', this.message.id);
  }

  selectAction(action: MessageAction) {
    this.actionSelected.emit({ messageId: this.message.id, action });
  }

  get reference(): MessageReference | undefined {
    return this.message?.reference;
  }

  get hasStructuredCards() {
    return this.message?.messageType === 'AI_STRUCTURED' && this.structuredCards.length > 0;
  }

  get structuredCards() {
    const cards = Array.isArray(this.message?.cards) ? this.message.cards : [];
    return cards.filter((card) => this.isRenderableCard(card));
  }

  get structuredSources() {
    if (!Array.isArray(this.message?.sources)) return [];
    return this.message.sources.filter((source) => {
      const objectType = String(source?.objectType || '').trim();
      const id = String(source?.id || '').trim();
      if (!objectType || !id) return false;
      return objectType.toLowerCase() !== 'routemeta';
    });
  }

  formatCardItem(item: string | { type?: string; example?: string }) {
    if (typeof item === 'string') return item;
    const type = String(item?.type || '').trim();
    const example = String(item?.example || '').trim();
    if (type && example) return `${type}: ${example}`;
    return type || example || '';
  }

  cardTitle(card: any) {
    const type = String(card?.type || '').trim().toLowerCase();
    if (type === 'summary') return 'Summary';
    if (type === 'assessment') return 'Assessment';
    if (type === 'gaps') return 'Gaps';
    if (type === 'evidence_needed') return 'Evidence Needed';
    if (type === 'recommended_actions') return 'Recommended Actions';
    return String(card?.title || card?.type || '').trim() || 'Card';
  }

  cardClass(card: any) {
    const type = String(card?.type || '').trim().toLowerCase();
    if (type === 'summary') return 'card-summary';
    if (type === 'assessment') return 'card-assessment';
    if (type === 'gaps') return 'card-gaps';
    if (type === 'evidence_needed') return 'card-evidence';
    if (type === 'recommended_actions') return 'card-actions';
    return '';
  }

  get referenceLabel() {
    if (!this.reference) return '';
    return this.reference.label || (this.reference.type === 'kb' ? 'Control reference' : 'Source');
  }

  get kbReference() {
    const ref = this.reference;
    return ref && ref.type === 'kb' ? ref : null;
  }

  get linkReference() {
    const ref = this.reference;
    return ref && ref.type === 'link' ? ref : null;
  }

  get isArabic() {
    return /[\u0600-\u06FF]/.test(this.message?.content || '');
  }

  get referenceEvidenceLabel() {
    return this.isArabic ? 'الأدلة المطلوبة' : 'Evidence expectations';
  }

  get referenceTestLabel() {
    return this.isArabic ? 'عناصر الاختبار' : 'Test components';
  }

  get referenceNote() {
    return this.isArabic
      ? 'مرجع فقط — القرار النهائي يعتمد على قواعد النظام الداخلية.'
      : 'Reference only — official compliance decisions follow internal KB rules.';
  }

  get closeLabel() {
    return this.isArabic ? 'إغلاق' : 'Close';
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

  private isRenderableCard(card: any) {
    if (!card || typeof card !== 'object') return false;
    const hasLines = Array.isArray(card.lines) && card.lines.some((line: unknown) => String(line || '').trim().length > 0);
    const hasItems = Array.isArray(card.items) && card.items.some((item: unknown) => String(this.formatCardItem(item as any) || '').trim().length > 0);
    const hasMeta = Boolean(card.status) || Number.isFinite(Number(card.confidence)) || Boolean(card.scope);
    return hasLines || hasItems || hasMeta;
  }
}
