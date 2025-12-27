import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UploadedDoc } from '../../models/uploaded-doc.model';

@Component({
  selector: 'app-uploaded-files-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './uploaded-files-list.component.html',
  styleUrl: './uploaded-files-list.component.css'
})
export class UploadedFilesListComponent {
  @Input() files: UploadedDoc[] = [];
  @Output() remove = new EventEmitter<string>();

  statusLabel(file: UploadedDoc) {
    if (file.status === 'uploaded') return 'Uploaded';
    if (file.status === 'processing') return 'Processing';
    return 'Failed';
  }
}
