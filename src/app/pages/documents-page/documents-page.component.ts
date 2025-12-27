import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { UploadService } from '../../services/upload.service';
import { UploadDropzoneComponent } from '../../components/upload-dropzone/upload-dropzone.component';
import { UploadedFilesListComponent } from '../../components/uploaded-files-list/uploaded-files-list.component';

@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [CommonModule, UploadDropzoneComponent, UploadedFilesListComponent],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.css'
})
export class DocumentsPageComponent {
  constructor(private readonly uploadService: UploadService) {}

  get documents() {
    return this.uploadService.documents();
  }

  onFiles(files: File[]) {
    if (!files.length) return;
    this.uploadService.uploadFiles(files);
  }

  remove(id: string) {
    this.uploadService.removeDocument(id);
  }
}
