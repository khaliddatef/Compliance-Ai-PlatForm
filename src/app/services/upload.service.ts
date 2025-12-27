import { Injectable, effect, signal } from '@angular/core';
import { interval, takeWhile, tap } from 'rxjs';
import { UploadedDoc, UploadStatus } from '../models/uploaded-doc.model';

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly storageKey = 'compliance-ai-uploaded-docs';
  private readonly hasBrowserStorage = typeof localStorage !== 'undefined';

  readonly documents = signal<UploadedDoc[]>(this.loadInitial());

  constructor() {
    effect(() => {
      if (!this.hasBrowserStorage) return;
      localStorage.setItem(this.storageKey, JSON.stringify(this.documents()));
    });
  }

  uploadFiles(files: File[]) {
    files.forEach((file) => {
      const doc: UploadedDoc = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type || this.fallbackType(file.name),
        status: 'processing' as const,
        progress: 10,
        uploadedAt: Date.now(),
      };

      this.documents.update((list) => [...list, doc]);
      this.simulateProgress(doc.id);
    });
  }

  removeDocument(id: string) {
    this.documents.update((list) => list.filter((doc) => doc.id !== id));
  }

  private simulateProgress(id: string) {
    const pace = interval(500).pipe(
      takeWhile(() => {
        const doc = this.documents().find((item) => item.id === id);
        return !!doc && doc.progress < 100;
      }),
      tap(() => {
        this.documents.update((list) =>
          list.map((item) => {
            if (item.id !== id) return item;

            const nextProgress = Math.min(item.progress + this.randomIncrement(), 100);
            const status: UploadStatus =
              nextProgress >= 100
                ? Math.random() > 0.1
                  ? 'uploaded'
                  : 'failed'
                : 'processing';

            return { ...item, progress: nextProgress, status };
          })
        );
      })
    );

    pace.subscribe();
  }

  private loadInitial(): UploadedDoc[] {
    if (this.hasBrowserStorage) {
      const cached = localStorage.getItem(this.storageKey);
      if (cached) {
        try {
          return JSON.parse(cached) as UploadedDoc[];
        } catch (error) {
          console.error('Failed to parse uploaded docs', error);
        }
      }
    }

    return [
      {
        id: crypto.randomUUID(),
        name: 'AccessPolicy.pdf',
        type: 'application/pdf',
        status: 'uploaded',
        progress: 100,
        uploadedAt: Date.now() - 1000 * 60 * 30,
      },
    ];
  }

  private randomIncrement() {
    return Math.floor(Math.random() * 25) + 8;
  }

  private fallbackType(name: string) {
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.docx'))
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (name.endsWith('.xlsx'))
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/octet-stream';
  }
}
