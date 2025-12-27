import { Injectable } from '@nestjs/common';

export type AgentCitation = {
  doc: string;
  page: number; // chunkIndex+1 (MVP)
  kind: 'STANDARD' | 'CUSTOMER';
};

export type AgentOutput = {
  reply: string;
  citations: AgentCitation[];
  complianceSummary: {
    standard: 'ISO' | 'FRA' | 'CBE';
    status: 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT';
    missing: { title: string; details?: string }[];
    recommendations: { title: string; details?: string }[];
  };
};

export type RagHit = {
  docName: string;
  chunkIndex: number;
  text: string;
  score: number;
  kind: 'STANDARD' | 'CUSTOMER';
};

@Injectable()
export class AgentService {
  private readonly apiKey = process.env.OPENAI_API_KEY || '';
  private readonly model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  private assertConfigured() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing in .env');
  }

  private buildContext(hits: RagHit[], label: string) {
    if (!hits.length) return `${label}: (no relevant chunks found)\n`;

    // ✅ ارفع السقف بدل 900 — وخلي عدد الـ chunks محدود
    const top = hits.slice(0, 6);

    const lines = top.map((h, idx) => {
      const snippet = (h.text || '').replace(/\s+/g, ' ').trim().slice(0, 2400);
      return [
        `[#${idx + 1}] KIND=${h.kind} DOC="${h.docName}" CHUNK=${h.chunkIndex} (pseudo-page=${h.chunkIndex + 1}) SCORE=${h.score}`,
        snippet,
      ].join('\n');
    });

    return `${label}:\n${lines.join('\n\n')}\n`;
  }

  private makeFallback(params: {
    standard: 'ISO' | 'FRA' | 'CBE';
    why: 'NO_STANDARD' | 'NO_CUSTOMER' | 'WEAK_CUSTOMER';
    customerDocName?: string;
  }): AgentOutput {
    const { standard, why, customerDocName } = params;

    if (why === 'NO_STANDARD') {
      return {
        reply: `I couldn't find any STANDARD (${standard}) context. Please upload the ${standard} standard once via /api/standards/upload.`,
        citations: [],
        complianceSummary: {
          standard,
          status: 'PARTIAL',
          missing: [{ title: 'Standard Requirements', details: 'Standard document not found/ingested.' }],
          recommendations: [{ title: 'Upload standard PDF', details: `Upload ${standard} standard under conversationId std-${standard}.` }],
        },
      };
    }

    if (why === 'NO_CUSTOMER') {
      return {
        reply: `I couldn't find any CUSTOMER evidence related to your question. Please upload customer policies/procedures/audit evidence (not generic documents).`,
        citations: [],
        complianceSummary: {
          standard,
          status: 'NOT_COMPLIANT',
          missing: [
            { title: 'Customer Evidence', details: 'No relevant customer evidence chunks found for this question.' },
          ],
          recommendations: [
            { title: 'Upload customer evidence', details: 'Access Control Policy, IAM procedures, privileged access management evidence, audit logs, etc.' },
          ],
        },
      };
    }

    // WEAK_CUSTOMER
    return {
      reply: `The uploaded CUSTOMER document doesn't look like compliance evidence (${customerDocName ?? 'unknown'}). Please upload relevant security/compliance documents.`,
      citations: [],
      complianceSummary: {
        standard,
        status: 'NOT_COMPLIANT',
        missing: [{ title: 'Customer Evidence', details: 'Uploaded document is not suitable as compliance evidence.' }],
        recommendations: [{ title: 'Upload correct evidence', details: 'Policies, procedures, controls mappings, audit reports, screenshots, tickets, logs.' }],
      },
    };
  }

  async answerCompliance(params: {
    standard: 'ISO' | 'FRA' | 'CBE';
    question: string;
    standardHits: RagHit[];
    customerHits: RagHit[];
  }): Promise<AgentOutput> {
    this.assertConfigured();

    const { standard, question, standardHits, customerHits } = params;

    // ✅ Logs تعرفك الـ LLM شغال ولا لأ
    console.log('[AGENT] model=', this.model, 'key?', !!this.apiKey);
    console.log('[AGENT] stdHits=', standardHits.length, 'cusHits=', customerHits.length);

    // ✅ Hard guards قبل ما ننادي OpenAI
    if (standardHits.length === 0) {
      return this.makeFallback({ standard, why: 'NO_STANDARD' });
    }

    if (customerHits.length === 0) {
      return this.makeFallback({ standard, why: 'NO_CUSTOMER' });
    }

    // ✅ detect garbage evidence بسرعة
    const customerDocName = (customerHits[0]?.docName || '').toLowerCase();
    const looksNonCompliance =
      customerDocName.includes('cpp') ||
      customerDocName.includes('problem solving') ||
      customerDocName.includes('mastery plan') ||
      customerDocName.includes('course');

    if (looksNonCompliance) {
      return this.makeFallback({ standard, why: 'WEAK_CUSTOMER', customerDocName: customerHits[0]?.docName });
    }

    const system = `
You are a compliance auditor assistant.
You MUST use ONLY the provided context snippets: STANDARD (official requirements) and CUSTOMER (company evidence).
Compare CUSTOMER evidence against STANDARD requirements relevant to the question.

Rules:
- Do NOT invent policies or evidence.
- If evidence is missing for a requirement, list it explicitly.
- Reply must be concise, structured, and actionable.
- Citations must reference ONLY provided snippets (doc + pseudo-page).

Return STRICT JSON only with this schema:
{
  "reply": "string",
  "citations": [{"doc":"string","page":number,"kind":"STANDARD|CUSTOMER"}],
  "complianceSummary":{
    "standard":"ISO|FRA|CBE",
    "status":"COMPLIANT|PARTIAL|NOT_COMPLIANT",
    "missing":[{"title":"string","details":"string?"}],
    "recommendations":[{"title":"string","details":"string?"}]
  }
}
`.trim();

    const context =
      this.buildContext(standardHits, `STANDARD(${standard}) CONTEXT`) +
      '\n' +
      this.buildContext(customerHits, `CUSTOMER CONTEXT`);

    const user = `
Question: ${question}

${context}
`.trim();

    // ✅ timeout للـ OpenAI call
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    let resp: Response;
    try {
      resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.error('[AGENT] OpenAI error:', resp.status, resp.statusText, txt.slice(0, 600));
      throw new Error(`OpenAI error: ${resp.status} ${resp.statusText}`);
    }

    const data: any = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}$/);
      if (!m) throw new Error('Agent did not return valid JSON.');
      parsed = JSON.parse(m[0]);
    }

    const out: AgentOutput = {
      reply: String(parsed?.reply ?? ''),
      citations: Array.isArray(parsed?.citations) ? parsed.citations : [],
      complianceSummary: {
        standard,
        status: parsed?.complianceSummary?.status ?? 'PARTIAL',
        missing: Array.isArray(parsed?.complianceSummary?.missing) ? parsed.complianceSummary.missing : [],
        recommendations: Array.isArray(parsed?.complianceSummary?.recommendations)
          ? parsed.complianceSummary.recommendations
          : [],
      },
    };

    if (!out.reply) out.reply = 'No answer generated.';
    return out;
  }
}
