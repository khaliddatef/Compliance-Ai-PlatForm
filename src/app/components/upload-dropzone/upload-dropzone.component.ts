import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-upload-dropzone',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upload-dropzone.component.html',
  styleUrl: './upload-dropzone.component.css'
})
export class UploadDropzoneComponent {
  @Output() filesAdded = new EventEmitter<File[]>();
  dragging = false;

  private readonly allowed = ['pdf', 'docx', 'xlsx'];

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging = false;
    const files = Array.from(event.dataTransfer?.files || []);
    this.emitAllowed(files);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging = true;
  }

  onDragLeave() {
    this.dragging = false;
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.emitAllowed(files);
    input.value = '';
  }

  private emitAllowed(files: File[]) {
    const filtered = files.filter((file) => this.isAllowed(file));
    this.filesAdded.emit(filtered);
  }

  private isAllowed(file: File) {
    const lower = file.name.toLowerCase();
    return this.allowed.some((ext) => lower.endsWith(ext));
  }
}
