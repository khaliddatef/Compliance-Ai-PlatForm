import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type ComposerSendPayload = {
  text: string;
  files: File[];
};

@Component({
  selector: 'app-composer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './composer.component.html',
  styleUrl: './composer.component.css'
})
export class ComposerComponent implements OnChanges {
  //   reset(){
  //   localStorage.clear();
  // }
  @Input() uploading = false;
  @Input() uploadProgress = 0;
  @Input() resetKey = 0;
  @Output() send = new EventEmitter<ComposerSendPayload>();
  draft = '';
  attachments: File[] = [];
  dragging = false;

  private readonly allowedExtensions = ['pdf', 'docx', 'xlsx'];
  private lastResetKey = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resetKey'] && this.resetKey !== this.lastResetKey) {
      this.attachments = [];
      this.lastResetKey = this.resetKey;
    }
  }

  get canSend() {
    return !this.uploading && (!!this.draft.trim() || this.attachments.length > 0);
  }

  submit() {
    const value = this.draft.trim();
    if (!value && !this.attachments.length) return;
    if (this.uploading) return;

    this.send.emit({ text: value, files: [...this.attachments] });
    this.draft = '';
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.submit();
    }
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
}

