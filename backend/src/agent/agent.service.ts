import { Injectable } from '@nestjs/common';

type ComplianceStatus = 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';

export type AgentComplianceResponse = {
  reply: string;
  citations: Array<{ doc: string; page: number | null; kind: 'STANDARD' | 'CUSTOMER' }>;
  complianceSummary: {
    standard: string;
    status: ComplianceStatus;
    missing: string[];
    recommendations: string[];
  };
};

type CustomerProbe = {
  // هل فيه دليل Customer فعلاً مرتبط بالسؤال؟
  hasRelevantCustomerEvidence: boolean;

  // أسماء ملفات العميل الموجودة في الـ customer store (للـ UI / debug)
  customerDocsSeen: string[];

  // سبب مختصر لو مش موجود/غير مرتبط
  reason: string;
};

@Injectable()
export class AgentService {
  private readonly apiKey = process.env.OPENAI_API_KEY || '';
  private readonly model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

  private assertConfig() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');
  }

  private stdStoreIdFor(standard: 'ISO' | 'FRA' | 'CBE'): string {
    const key =
      standard === 'ISO'
        ? process.env.OPENAI_VECTOR_STORE_STD_ISO
        : standard === 'FRA'
          ? process.env.OPENAI_VECTOR_STORE_STD_FRA
          : process.env.OPENAI_VECTOR_STORE_STD_CBE;

    if (!key) {
      throw new Error(`Missing env var for standard vector store: OPENAI_VECTOR_STORE_STD_${standard}`);
    }
    return key;
  }

  // ---------------------------
  // 1) CUSTOMER-ONLY PROBE (NO STANDARD!)
  // ---------------------------
  private async probeCustomerEvidence(params: {
    question: string;
    customerVectorStoreId: string;
  }): Promise<CustomerProbe> {
    const { question, customerVectorStoreId } = params;

    const probeInstructions = `
You are validating whether the CUSTOMER uploaded evidence is relevant to the user's question.

You MUST use ONLY the CUSTOMER vector store search results.
Do NOT use any STANDARD documents.
Return STRICT JSON only.

Rules:
- If you cannot find any relevant CUSTOMER evidence, set hasRelevantCustomerEvidence=false.
- Extract customerDocsSeen from CUSTOMER results filenames/doc names (best effort).
- Be conservative: do not guess relevance without explicit evidence in CUSTOMER results.
`;

    const probeSchema = {
      name: 'customer_probe',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['hasRelevantCustomerEvidence', 'customerDocsSeen', 'reason'],
        properties: {
          hasRelevantCustomerEvidence: { type: 'boolean' },
          customerDocsSeen: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
      },
    } as const;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const body = {
        model: this.model,
        instructions: probeInstructions,
        input: `User question: ${question}\n\nCheck CUSTOMER evidence relevance.`,
        tools: [
          {
            type: 'file_search',
            vector_store_ids: [customerVectorStoreId], // ✅ CUSTOMER ONLY
            max_num_results: 8,
          },
        ],
        include: ['file_search_call.results'],
        text: {
          format: {
            type: 'json_schema',
            name: 'customer_probe',
            schema: probeSchema.schema,
            strict: true,
          },
        },
      };

      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      const json = await resp.json();

      if (!resp.ok) {
        console.error('[CustomerProbe] HTTP error', resp.status, JSON.stringify(json)?.slice(0, 2000));
        // لو probe فشل، نعتبر مفيش customer evidence عشان ما نغلطش
        return {
          hasRelevantCustomerEvidence: false,
          customerDocsSeen: [],
          reason: 'Customer probe failed (treat as no customer evidence).',
        };
      }

      const outputText: string | undefined = json?.output_text;
      let parsed: CustomerProbe | null = null;

      if (typeof outputText === 'string' && outputText.trim().startsWith('{')) {
        parsed = JSON.parse(outputText);
      } else {
        const msg = (json?.output || []).find((x: any) => x?.type === 'message');
        const parts = msg?.content || [];
        const out = parts.find((p: any) => p?.type === 'output_text')?.text;
        if (typeof out === 'string' && out.trim().startsWith('{')) parsed = JSON.parse(out);
      }

      if (!parsed) {
        return {
          hasRelevantCustomerEvidence: false,
          customerDocsSeen: [],
          reason: 'Customer probe returned unparsable output.',
        };
      }

      // Normalize
      parsed.customerDocsSeen = Array.isArray(parsed.customerDocsSeen) ? parsed.customerDocsSeen : [];
      parsed.reason = String(parsed.reason || '');

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Customer probe timed out' : e?.message || String(e);
      console.error('[CustomerProbe] exception:', msg);
      return {
        hasRelevantCustomerEvidence: false,
        customerDocsSeen: [],
        reason: msg,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------
  // 2) MAIN ANSWER (STANDARD + CUSTOMER)
  // ---------------------------
  async answerCompliance(params: {
    standard: 'ISO' | 'FRA' | 'CBE';
    question: string;
    customerVectorStoreId?: string | null;
  }): Promise<AgentComplianceResponse> {
    this.assertConfig();

    const { standard, question, customerVectorStoreId } = params;
    const stdVectorStoreId = this.stdStoreIdFor(standard);

    // ✅ لو مفيش customer store: ندي guidance عام + UNKNOWN
    if (!customerVectorStoreId) {
      return this.answerGeneral({ standard, question });
    }

    // ✅ Probe customer store only (يحسم موضوع الملف)
    const probe = await this.probeCustomerEvidence({
      question,
      customerVectorStoreId,
    });

    // ✅ لو مفيش evidence مرتبط: اقفل الباب قبل ما يخلط standard/customer
    if (!probe.hasRelevantCustomerEvidence) {
      return {
        reply:
          `I can’t confirm that your uploaded customer document is relevant to this question based on the customer evidence I can see. ` +
          `It may be unrelated (or not enough detail). Please upload access control evidence such as: ` +
          `access control policy, user provisioning/deprovisioning records, MFA/SSO configuration screenshots, access review reports, and audit logs. ` +
          (probe.customerDocsSeen.length
            ? `\n\nCustomer docs detected: ${probe.customerDocsSeen.slice(0, 5).join(', ')}`
            : ''),
        citations: [],
        complianceSummary: {
          standard,
          status: 'UNKNOWN',
          missing: ['Relevant customer evidence not found for this question.'],
          recommendations: [
            'Upload access control policy + identity provider (SSO/MFA) configuration evidence',
            'Upload user access review evidence (periodic review reports / tickets)',
            'Upload audit logs or monitoring evidence related to access',
          ],
        },
      };
    }

    // ✅ MAIN instructions: نسمح assessment الآن
    const instructions = `
You are a senior cybersecurity compliance consultant.

Two modes:
1) General guidance: you may explain standards and best practices, but never claim compliance without CUSTOMER evidence.
2) Compliance assessment: compare CUSTOMER evidence against STANDARD requirements.

NON-NEGOTIABLE:
- STANDARD documents are reference only and MUST NEVER be treated as customer evidence.
- Any compliance claim MUST be supported by CUSTOMER citations.
- If customer evidence is missing or irrelevant, complianceSummary.status MUST be "UNKNOWN".

Return STRICT JSON only.
Keep answers concise.
`;

    const responseSchema = {
      name: 'compliance_assessment',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['reply', 'citations', 'complianceSummary'],
        properties: {
          reply: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['doc', 'page', 'kind'],
              properties: {
                doc: { type: 'string' },
                page: { type: ['number', 'null'] },
                kind: { type: 'string', enum: ['STANDARD', 'CUSTOMER'] },
              },
            },
          },
          complianceSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['standard', 'status', 'missing', 'recommendations'],
            properties: {
              standard: { type: 'string' },
              status: {
                type: 'string',
                enum: ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'],
              },
              missing: { type: 'array', items: { type: 'string' } },
              recommendations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    } as const;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const body = {
        model: this.model,
        instructions,
        input: `Standard=${standard}\nUser question: ${question}\n\nAssess compliance using BOTH stores but NEVER treat STANDARD as customer evidence.`,
        tools: [
          {
            type: 'file_search',
            vector_store_ids: [stdVectorStoreId, customerVectorStoreId],
            max_num_results: 8,
          },
        ],
        include: ['file_search_call.results'],
        text: {
          format: {
            type: 'json_schema',
            name: 'compliance_assessment',
            schema: responseSchema.schema,
            strict: true,
          },
        },
      };

      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      const json = await resp.json();

      if (!resp.ok) {
        console.error('[LLM] HTTP error', resp.status, JSON.stringify(json)?.slice(0, 2000));
        throw new Error(`OpenAI responses error: ${resp.status}`);
      }

      let outputText: string | undefined = json?.output_text;
      let parsed: AgentComplianceResponse | null = null;

      if (typeof outputText === 'string' && outputText.trim().startsWith('{')) {
        parsed = JSON.parse(outputText);
      } else {
        const msg = (json?.output || []).find((x: any) => x?.type === 'message');
        const parts = msg?.content || [];
        const out = parts.find((p: any) => p?.type === 'output_text')?.text;
        if (typeof out === 'string' && out.trim().startsWith('{')) parsed = JSON.parse(out);
      }

      if (!parsed) {
        console.error('[LLM] Could not parse structured output. Raw=', JSON.stringify(json)?.slice(0, 2000));
        throw new Error('Failed to parse structured output from OpenAI');
      }

      parsed.citations = (parsed.citations || []).map((c) => ({
        doc: c.doc,
        page: c.page ?? null,
        kind: c.kind,
      }));

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[LLM] exception:', msg);

      return {
        reply: `LLM call failed: ${msg}`,
        citations: [],
        complianceSummary: {
          standard,
          status: 'UNKNOWN',
          missing: ['LLM call failed (check backend logs)'],
          recommendations: [
            'Verify OPENAI_API_KEY, model, and vector store IDs',
            'Check OpenAI logs in the platform dashboard',
          ],
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------
  // 2A) GENERAL ANSWER (NO CUSTOMER EVIDENCE)
  // ---------------------------
  private async answerGeneral(params: {
    standard: 'ISO' | 'FRA' | 'CBE';
    question: string;
  }): Promise<AgentComplianceResponse> {
    this.assertConfig();

    const { standard, question } = params;

    const instructions = `
You are a cybersecurity compliance assistant for ${standard}.
Provide concise guidance and recommended evidence.
Do NOT claim compliance without customer evidence.
Always set complianceSummary.status to "UNKNOWN".
Return STRICT JSON only.
`;

    const responseSchema = {
      name: 'compliance_assessment',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['reply', 'citations', 'complianceSummary'],
        properties: {
          reply: { type: 'string' },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['doc', 'page', 'kind'],
              properties: {
                doc: { type: 'string' },
                page: { type: ['number', 'null'] },
                kind: { type: 'string', enum: ['STANDARD', 'CUSTOMER'] },
              },
            },
          },
          complianceSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['standard', 'status', 'missing', 'recommendations'],
            properties: {
              standard: { type: 'string' },
              status: {
                type: 'string',
                enum: ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'],
              },
              missing: { type: 'array', items: { type: 'string' } },
              recommendations: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    } as const;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const body = {
        model: this.model,
        instructions,
        input: `Standard=${standard}\nUser question: ${question}\nProvide guidance without claiming compliance.`,
        text: {
          format: {
            type: 'json_schema',
            name: 'compliance_assessment',
            schema: responseSchema.schema,
            strict: true,
          },
        },
      };

      const resp = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      const json = await resp.json();

      if (!resp.ok) {
        console.error('[LLM] HTTP error', resp.status, JSON.stringify(json)?.slice(0, 2000));
        throw new Error(`OpenAI responses error: ${resp.status}`);
      }

      let outputText: string | undefined = json?.output_text;
      let parsed: AgentComplianceResponse | null = null;

      if (typeof outputText === 'string' && outputText.trim().startsWith('{')) {
        parsed = JSON.parse(outputText);
      } else {
        const msg = (json?.output || []).find((x: any) => x?.type === 'message');
        const parts = msg?.content || [];
        const out = parts.find((p: any) => p?.type === 'output_text')?.text;
        if (typeof out === 'string' && out.trim().startsWith('{')) parsed = JSON.parse(out);
      }

      if (!parsed) {
        console.error('[LLM] Could not parse structured output. Raw=', JSON.stringify(json)?.slice(0, 2000));
        throw new Error('Failed to parse structured output from OpenAI');
      }

      parsed.citations = (parsed.citations || []).map((c) => ({
        doc: c.doc,
        page: c.page ?? null,
        kind: c.kind,
      }));

      if (!parsed.complianceSummary) {
        parsed.complianceSummary = {
          standard,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        };
      } else {
        parsed.complianceSummary.standard = standard;
        parsed.complianceSummary.status = 'UNKNOWN';
      }

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[LLM] exception:', msg);

      return {
        reply:
          `I’m a cybersecurity compliance assistant. I can explain ${standard} requirements and what evidence is typically needed. ` +
          `To assess your compliance, please upload customer evidence (policies, procedures, screenshots, audit logs, access review records, etc.).`,
        citations: [],
        complianceSummary: {
          standard,
          status: 'UNKNOWN',
          missing: ['No customer evidence store is linked to this conversation yet.'],
          recommendations: [
            'Upload customer evidence documents (policies/procedures/access control docs/audit logs)',
            'Ask a focused question (e.g., “Access control: MFA + least privilege + provisioning + reviews”)',
          ],
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
