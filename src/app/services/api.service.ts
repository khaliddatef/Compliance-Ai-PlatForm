import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { map } from 'rxjs/operators';

export type ComplianceStandard = 'ISO' | 'FRA' | 'CBE';

export type Citation = {
  doc: string;
  page: number;
  kind?: 'STANDARD' | 'CUSTOMER';
};

export type ComplianceSummary = {
  standard: ComplianceStandard;
  status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT';
  missing: { title: string; details?: string }[];
  recommendations: { title: string; details?: string }[];
};

/**
 * ✅ ده الـ type اللي الفرونت عندك بيستورده
 * علشان يصلّح error: has no exported member 'ChatApiResponse'
 */
export type ChatApiResponse = {
  conversationId: string;
  assistantMessage: string;

  // ✅ fields your components expect directly
  reply: string;
  citations: Citation[];
  complianceSummary: ComplianceSummary;
};

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // ===== Uploads =====

  uploadCustomerFiles(conversationId: string, standard: ComplianceStandard, files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);

    const params = new HttpParams()
      .set('conversationId', conversationId)
      .set('standard', standard)
      .set('kind', 'CUSTOMER');

    return this.http.post('/api/uploads', fd, { params });
  }

  uploadStandardFiles(standard: ComplianceStandard, files: File[]) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);

    const params = new HttpParams().set('standard', standard);
    return this.http.post('/api/standards/upload', fd, { params });
  }

  listUploads(conversationId: string) {
    const params = new HttpParams().set('conversationId', conversationId);
    return this.http.get('/api/uploads', { params });
  }

  // ===== Chat (new) =====

  chat(conversationId: string, standard: ComplianceStandard, message: string) {
    return this.http.post<any>('/api/chat', { conversationId, standard, message });
  }

  // ===== Chat (compat with your existing frontend code) =====
  /**
   * ✅ الكود عندك بينادي sendMessage()
   * فهنرجّعها تاني كـ wrapper حوالين /api/chat
   */
sendMessage(message: string, standard: ComplianceStandard, conversationId?: string) {
  const convId = conversationId || 'demo-1';

  return this.chat(convId, standard, message).pipe(
    map((res) => {
      const reply = String(res?.reply ?? '');
      const backendConversationId = String(res?.conversationId ?? convId);

      const out: ChatApiResponse = {
        conversationId: backendConversationId,
        assistantMessage: reply,  // ✅ for old UI code
        reply,                    // ✅ for your current code
        citations: Array.isArray(res?.citations) ? res.citations : [],
        complianceSummary: res?.complianceSummary ?? {
          standard,
          status: 'PARTIAL',
          missing: [],
          recommendations: [],
        },
      };

      return out;
    }),
  );
}
}
