export type UploadStatus = 'uploaded' | 'processing' | 'failed';

export interface UploadedDoc {
  id: string;
  name: string;
  type: string;
  status: UploadStatus;
  progress: number;
  uploadedAt: number;
}
