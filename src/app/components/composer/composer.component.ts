import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

export type ComposerMentionOption = {
  id: string;
  name: string;
  mimeType?: string | null;
  createdAt?: string | null;
};

export type ComposerSendPayload = {
  text: string;
  files: File[];
  mentionedDocumentIds?: string[];
};

@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer.component.html',
  styleUrl: './composer.component.css'
})
export class ComposerComponent implements OnChanges {
  @Input() uploading = false;
  @Input() uploadProgress = 0;
  @Input() resetKey = 0;
  @Input() mentionOptions: ComposerMentionOption[] = [];
  @Output() send = new EventEmitter<ComposerSendPayload>();
  draft = '';
  attachments: File[] = [];
  selectedMentions: ComposerMentionOption[] = [];
  mentionOpen = false;
  mentionCandidates: ComposerMentionOption[] = [];
  mentionIndex = 0;
  mentionQuery = '';
  dragging = false;
  @ViewChild('composerRoot') composerRoot?: ElementRef<HTMLElement>;
  @ViewChild('composerInput') composerInput?: ElementRef<HTMLTextAreaElement>;

  private readonly allowedExtensions = ['pdf', 'docx', 'xlsx'];
  private lastResetKey = 0;
  private readonly minHeight = 32;
  private readonly maxHeight = 160;
  private mentionTrigger: { start: number; end: number } | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resetKey'] && this.resetKey !== this.lastResetKey) {
      this.attachments = [];
      this.selectedMentions = [];
      this.lastResetKey = this.resetKey;
      this.resetTextareaHeight();
      this.closeMentionMenu();
    }
    if (changes['mentionOptions']) {
      this.updateMentionState();
    }
  }

  get canSend() {
    return !this.uploading && (!!this.draft.trim() || this.attachments.length > 0);
  }

  submit() {
    const value = this.draft.trim();
    if (!value && !this.attachments.length) return;
    if (this.uploading) return;

    this.send.emit({
      text: value,
      files: [...this.attachments],
      mentionedDocumentIds: this.selectedMentions.map((item) => item.id),
    });
    this.draft = '';
    this.selectedMentions = [];
    this.closeMentionMenu();
    this.resetTextareaHeight();
  }

  handleKeydown(event: KeyboardEvent) {
    if (this.mentionOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMentionMenu();
        return;
      }
      if (this.mentionCandidates.length) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.mentionIndex = (this.mentionIndex + 1) % this.mentionCandidates.length;
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.mentionIndex =
            (this.mentionIndex - 1 + this.mentionCandidates.length) % this.mentionCandidates.length;
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          this.selectMention(this.mentionCandidates[this.mentionIndex]);
          return;
        }
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
  }

  autoResize(event: Event) {
    const target = event.target as HTMLTextAreaElement | null;
    const el = target || this.composerInput?.nativeElement;
    if (!el) return;

    el.style.height = '0px';
    const styles = getComputedStyle(el);
    const minHeight = Number.parseInt(styles.minHeight || `${this.minHeight}`, 10) || this.minHeight;
    const maxHeight = Number.parseInt(styles.maxHeight || `${this.maxHeight}`, 10) || this.maxHeight;
    const next = Math.min(el.scrollHeight, maxHeight);
    const height = Math.max(next, minHeight);
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
    this.updateMentionState(el);
  }

  onFileInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.addAttachments(files);
    input.value = '';
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging = false;
    const files = Array.from(event.dataTransfer?.files || []);
    this.addAttachments(files);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging = true;
  }

  onDragLeave() {
    this.dragging = false;
  }

  removeAttachment(index: number) {
    this.attachments = this.attachments.filter((_, idx) => idx !== index);
  }

  removeMention(index: number) {
    this.selectedMentions = this.selectedMentions.filter((_, idx) => idx !== index);
  }

  onMentionMouseDown(event: MouseEvent, option: ComposerMentionOption) {
    event.preventDefault();
    this.selectMention(option);
  }

  formatSize(bytes: number) {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  private addAttachments(files: File[]) {
    if (!files.length) return;
    const next = [...this.attachments];

    files.forEach((file) => {
      if (!this.isAllowed(file)) return;
      const exists = next.some((f) => f.name === file.name && f.size === file.size);
      if (!exists) {
        next.push(file);
      }
    });

    this.attachments = next;
  }

  private isAllowed(file: File) {
    const name = file.name.toLowerCase();
    return this.allowedExtensions.some((ext) => name.endsWith(`.${ext}`));
  }

  private selectMention(option?: ComposerMentionOption) {
    if (!option || !this.mentionTrigger) return;
    const trigger = this.mentionTrigger;
    const before = this.draft.slice(0, trigger.start);
    const after = this.draft.slice(trigger.end);
    const inserted = `@${option.name} `;
    this.draft = `${before}${inserted}${after}`;

    const exists = this.selectedMentions.some((item) => item.id === option.id);
    if (!exists) {
      this.selectedMentions = [...this.selectedMentions, option];
    }

    const caret = before.length + inserted.length;
    this.closeMentionMenu();
    this.resetTextareaHeight();

    setTimeout(() => {
      const el = this.composerInput?.nativeElement;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      this.autoResize(new Event('input'));
    }, 0);
  }

  private updateMentionState(target?: HTMLTextAreaElement) {
    const el = target || this.composerInput?.nativeElement;
    if (!el) {
      this.closeMentionMenu();
      return;
    }

    const caret = Number.isFinite(el.selectionStart) ? el.selectionStart : this.draft.length;
    const leftText = this.draft.slice(0, caret);
    const match = leftText.match(/(^|\s)@([^\s@]*)$/);
    if (!match) {
      this.closeMentionMenu();
      return;
    }

    const query = String(match[2] || '').trim().toLowerCase();
    const triggerStart = leftText.length - String(match[2] || '').length - 1;
    const options = this.mentionOptions
      .filter((item) => {
        const id = String(item?.id || '').trim();
        const name = String(item?.name || '').trim();
        if (!id || !name) return false;
        if (this.selectedMentions.some((selected) => selected.id === id)) return false;
        if (!query) return true;
        return name.toLowerCase().includes(query);
      })
      .slice(0, 8);

    this.mentionOpen = true;
    this.mentionCandidates = options;
    this.mentionQuery = query;
    this.mentionIndex = 0;
    this.mentionTrigger = { start: triggerStart, end: caret };
  }

  private closeMentionMenu() {
    this.mentionOpen = false;
    this.mentionCandidates = [];
    this.mentionIndex = 0;
    this.mentionQuery = '';
    this.mentionTrigger = null;
  }

  private resetTextareaHeight() {
    const el = this.composerInput?.nativeElement;
    if (!el) return;
    const styles = getComputedStyle(el);
    const minHeight = Number.parseInt(styles.minHeight || `${this.minHeight}`, 10) || this.minHeight;
    el.style.height = `${minHeight}px`;
    el.style.overflowY = 'hidden';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    if (!this.mentionOpen) return;
    const root = this.composerRoot?.nativeElement;
    const target = event.target;
    if (root && target instanceof Node && root.contains(target)) return;
    this.closeMentionMenu();
  }
}
