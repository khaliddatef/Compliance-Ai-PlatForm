import { Injectable } from '@nestjs/common';

type ComplianceStatus = 'COMPLIANT' | 'PARTIAL' | 'NOT_COMPLIANT' | 'UNKNOWN';

export type ExternalLink = {
  title: string;
  url: string;
};

export type AgentComplianceResponse = {
  reply: string;
  citations: Array<{ doc: string; page: number | null; kind: 'CUSTOMER' }>;
  complianceSummary: {
    framework: string | null;
    status: ComplianceStatus;
    missing: string[];
    recommendations: string[];
  };
  externalLinks?: ExternalLink[];
};

export type AgentControlEvaluation = {
  status: ComplianceStatus;
  summary: string;
  satisfied: string[];
  missing: string[];
  recommendations: string[];
  citations: Array<{ doc: string; page: number | null; kind: 'CUSTOMER' }>;
};

export type DocumentMatchResult = {
  docType: string;
  matchControlId: string | null;
  matchStatus: ComplianceStatus;
  matchNote: string;
  matchRecommendations: string[];
};

export type ControlContext = {
  id: string;
  title: string;
  summary: string;
  evidence: string[];
  testComponents: string[];
};

export type ControlCandidate = {
  controlCode: string;
  title: string;
  isoMappings?: string[] | null;
};

export type EvidenceChunk = {
  docName: string;
  text: string;
  chunkIndex?: number;
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

  private detectLanguage(text: string): 'ar' | 'en' {
    return /[\u0600-\u06FF]/.test(text || '') ? 'ar' : 'en';
  }

  private formatEvidenceChunks(chunks: EvidenceChunk[]) {
    if (!chunks?.length) return '';
    const maxChunkChars = 900;
    const maxTotalChars = 7000;
    let total = 0;
    const lines: string[] = [];

    for (const chunk of chunks) {
      const docName = String(chunk.docName || 'document');
      const index = Number.isFinite(chunk.chunkIndex) ? ` (chunk ${chunk.chunkIndex})` : '';
      const text = String(chunk.text || '').trim().slice(0, maxChunkChars);
      if (!text) continue;
      const block = `Doc: ${docName}${index}\n${text}`;
      lines.push(block);
      total += block.length;
      if (total >= maxTotalChars) break;
    }

    return lines.join('\n\n');
  }

  private filterCitationsByDocs(
    citations: Array<{ doc: string; page: number | null; kind: 'CUSTOMER' }>,
    allowedDocs: Set<string>,
  ) {
    if (!Array.isArray(citations)) return [];
    const normalized = new Set(Array.from(allowedDocs.values()).map((name) => name.trim()));
    return citations
      .filter((c) => normalized.has(String(c?.doc || '').trim()))
      .map((c) => ({
        doc: String(c.doc || '').trim(),
        page: c.page ?? null,
        kind: 'CUSTOMER' as const,
      }));
  }

  private assertConfig() {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is missing');
  }

  private frameworkLabel(framework?: string | null, language?: 'ar' | 'en') {
    const value = String(framework || '').trim();
    if (value) return value;
    return language === 'ar' ? 'الإطار النشط' : 'the active framework';
  }

  private shouldSearchWeb(question: string) {
    const value = (question || '').toLowerCase();
    if (!value) return false;
    const triggers = [
      'search',
      'google',
      'web',
      'source',
      'sources',
      'reference',
      'references',
      'link',
      'links',
      'ابحث',
      'دور',
      'سيرش',
      'مصدر',
      'مصادر',
      'مراجع',
      'لينك',
      'روابط',
    ];
    return triggers.some((term) => value.includes(term));
  }

  private async searchWeb(query: string): Promise<ExternalLink[]> {
    const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    try {
      const resp = await fetch(endpoint);
      if (!resp.ok) return [];
      const json: any = await resp.json();
      const results: ExternalLink[] = [];

      if (json?.AbstractURL) {
        results.push({
          title: json?.Heading || json?.AbstractText || query,
          url: json.AbstractURL,
        });
      }

      const related = Array.isArray(json?.RelatedTopics) ? json.RelatedTopics : [];
      for (const item of related) {
        if (results.length >= 5) break;
        if (item?.FirstURL && item?.Text) {
          results.push({ title: item.Text, url: item.FirstURL });
          continue;
        }
        const nested = Array.isArray(item?.Topics) ? item.Topics : [];
        for (const topic of nested) {
          if (results.length >= 5) break;
          if (topic?.FirstURL && topic?.Text) {
            results.push({ title: topic.Text, url: topic.FirstURL });
          }
        }
      }

      const seen = new Set<string>();
      return results.filter((link) => {
        if (!link.url || seen.has(link.url)) return false;
        seen.add(link.url);
        return true;
      });
    } catch (e: any) {
      console.warn('[WEB SEARCH] failed', e?.message || e);
      return [];
    }
  }

  private formatExternalLinks(language: 'ar' | 'en', links: ExternalLink[]) {
    if (!links.length) return '';
    const header = language === 'ar' ? 'مراجع خارجية (روابط مفيدة):' : 'External references (useful links):';
    const list = links.map((link) => `- ${link.title} — ${link.url}`).join('\n');
    return `${header}\n${list}`;
  }

  // ---------------------------
  // 1) CUSTOMER-ONLY PROBE
  // ---------------------------
  private async probeCustomerEvidence(params: {
    question: string;
    customerVectorStoreId: string;
  }): Promise<CustomerProbe> {
    const { question, customerVectorStoreId } = params;

    const probeInstructions = `
You are validating whether the CUSTOMER uploaded evidence is relevant to the user's question.

You MUST use ONLY the CUSTOMER vector store search results.
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
  // 2) MAIN ANSWER (CUSTOMER ONLY)
  // ---------------------------
  async answerCompliance(params: {
    framework?: string | null;
    question: string;
    evidenceChunks?: EvidenceChunk[];
    hasCustomerDocs?: boolean;
    language?: 'ar' | 'en';
  }): Promise<AgentComplianceResponse> {
    this.assertConfig();

    const {
      framework,
      question,
      evidenceChunks = [],
      hasCustomerDocs = false,
      language: forcedLanguage,
    } = params;
    const language = forcedLanguage ?? this.detectLanguage(question);
    const wantsWeb = this.shouldSearchWeb(question);
    const webSearchPromise = wantsWeb ? this.searchWeb(question) : Promise.resolve([]);

    // ✅ لو مفيش أدلة عميل (ولا ملفات أصلاً): ندي guidance عام + UNKNOWN
    if (!hasCustomerDocs) {
      return this.answerGeneral({ framework, question, language });
    }

    // ✅ لو مفيش evidence مطابق: اقفل الباب قبل ما نخلط
    if (!evidenceChunks.length) {
      const externalLinks = await webSearchPromise;
      const extra =
        wantsWeb && externalLinks.length
          ? `\n\n${this.formatExternalLinks(language, externalLinks)}`
          : wantsWeb
            ? language === 'ar'
              ? '\n\nلم أجد نتائج موثوقة عبر البحث. لو عايز مصادر معينة، قولي أسماء الجهات أو المواقع.'
              : '\n\nI could not find reliable results. If you want specific sources, tell me the organizations or sites.'
            : '';

      const reply =
        language === 'ar'
          ? `مش قادر أأكد إن الملف المرفوع مرتبط بسؤالك بناءً على الأدلة المتاحة عندي. ` +
            `ممكن يكون غير متعلق أو التفاصيل مش كفاية. من فضلك ارفع أدلة مرتبطة بموضوع السؤال مثل: ` +
            `سياسات، إجراءات، سجلات تشغيل/مراجعة، لقطات شاشة، أو تقارير تدقيق.`
          : `I can’t confirm that the uploaded file is relevant to your question based on the evidence I can see. ` +
            `It may be unrelated (or not enough detail). Please upload evidence relevant to your question such as: ` +
            `policies, procedures, logs, screenshots, or audit reports.`;

        return {
          reply:
            reply +
          extra,
          citations: [],
          externalLinks: externalLinks.length ? externalLinks : undefined,
          complianceSummary: {
            framework: framework ?? null,
            status: 'UNKNOWN',
            missing:
              language === 'ar'
                ? ['لم يتم العثور على أدلة عميل مناسبة لهذا السؤال.']
              : ['Relevant customer evidence not found for this question.'],
          recommendations:
            language === 'ar'
              ? [
                  'ارفع سياسات أو إجراءات مرتبطة بالسؤال',
                  'ارفع سجلات/تقارير أو لقطات شاشة توضح التنفيذ',
                  'لو عندك مستندات مراجعة أو تدقيق، ارفعها للمطابقة',
                ]
              : [
                  'Upload policies or procedures relevant to the question',
                  'Upload logs/reports or screenshots that show implementation',
                  'If you have review/audit documents, upload them for matching',
                ],
        },
      };
    }

    // ✅ MAIN instructions: نسمح assessment الآن
    const instructions = `
You are the chat interface of Tekronyx, a Chat-First GRC & Cybersecurity Compliance platform.

You are NOT:
- an auditor
- an examiner
- a rigid checklist tool
- a general-purpose chatbot

You ARE a calm, supportive, honest colleague walking side-by-side with the user.

Language:
- Always respond in ${language === 'ar' ? 'Arabic' : 'English'} only.
- Do not mix languages in the same response (except file names or control IDs).

Scope & behavior:
- Stay within GRC/cybersecurity compliance.
- If the user asks about unrelated topics, decline briefly and redirect to compliance.
- If the request is ambiguous, ask up to 2 clarifying questions (one at a time).
- If the user says they don’t understand, rephrase simply and give a short example.
- Never present uncertain info as fact.
- If the user asks for a compliance verdict, explain that formal decisions come from the internal Control Knowledge Base and evidence evaluation.
- Current framework context: ${this.frameworkLabel(framework, language)}. Do not mention the framework unless the user asks or it is needed to answer accurately. If the user asks about a different framework, ask which one to use.

Evidence & guidance:
- Use ONLY the provided CUSTOMER evidence snippets.
- If evidence is missing or unclear, say so and set status to "UNKNOWN".
- This chat provides guidance only. Do NOT make compliance decisions here.
- Always set complianceSummary.status to "UNKNOWN".
- For citations, use document names exactly as shown in the evidence snippets.

Transparency:
- If you reference framework requirements, say it is guidance and not a compliance decision.

Return STRICT JSON only.
Keep answers concise, supportive, and action-oriented.
Structure:
1) Short acknowledgement.
2) Helpful guidance in 3-5 short sentences.
3) One clear next step or question.
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
                kind: { type: 'string', enum: ['CUSTOMER'] },
              },
            },
          },
          complianceSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['framework', 'status', 'missing', 'recommendations'],
            properties: {
              framework: { type: 'string' },
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
      const evidenceText = this.formatEvidenceChunks(evidenceChunks);
      const allowedDocs = new Set(
        evidenceChunks.map((chunk) => String(chunk.docName || '').trim()).filter(Boolean),
      );
      const body = {
        model: this.model,
        instructions,
        input:
          `Framework=${this.frameworkLabel(framework, language)}\n` +
          `User question: ${question}\n\n` +
          `Customer evidence snippets:\n${evidenceText}`,
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

      const externalLinks = await webSearchPromise;
      if (wantsWeb) {
        const extra =
          externalLinks.length
            ? `\n\n${this.formatExternalLinks(language, externalLinks)}`
            : language === 'ar'
              ? '\n\nلم أجد نتائج موثوقة عبر البحث. لو عايز مصادر معينة، قولي أسماء الجهات أو المواقع.'
              : '\n\nI could not find reliable results. If you want specific sources, tell me the organizations or sites.';
        parsed.reply = `${parsed.reply}${extra}`;
        parsed.externalLinks = externalLinks.length ? externalLinks : undefined;
      }

      parsed.citations = this.filterCitationsByDocs(
        Array.isArray(parsed.citations) ? parsed.citations : [],
        allowedDocs,
      );

      if (!parsed.complianceSummary) {
        parsed.complianceSummary = {
          framework: framework ?? null,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        };
      } else {
        parsed.complianceSummary.framework = framework ?? null;
        parsed.complianceSummary.status = 'UNKNOWN';
      }

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[LLM] exception:', msg);

      const reply =
        language === 'ar'
          ? `حصلت مشكلة في الاتصال بالمساعد. من فضلك جرّب مرة تانية.`
          : `LLM call failed: ${msg}`;
      const externalLinks = wantsWeb ? await webSearchPromise : [];
      const extra =
        wantsWeb && externalLinks.length
          ? `\n\n${this.formatExternalLinks(language, externalLinks)}`
          : wantsWeb
            ? language === 'ar'
              ? '\n\nلم أجد نتائج موثوقة عبر البحث. لو عايز مصادر معينة، قولي أسماء الجهات أو المواقع.'
              : '\n\nI could not find reliable results. If you want specific sources, tell me the organizations or sites.'
            : '';

      return {
        reply: reply + extra,
        citations: [],
        externalLinks: externalLinks.length ? externalLinks : undefined,
        complianceSummary: {
          framework: framework ?? null,
          status: 'UNKNOWN',
          missing:
            language === 'ar'
              ? ['فشل استدعاء المساعد (راجع سجلات الباك‑إند).']
              : ['LLM call failed (check backend logs)'],
          recommendations:
            language === 'ar'
              ? [
                  'تأكد من OPENAI_API_KEY وإعدادات الموديل',
                  'راجع سجلات OpenAI في لوحة التحكم',
                ]
              : [
                  'Verify OPENAI_API_KEY and model configuration',
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
    framework?: string | null;
    question: string;
    language?: 'ar' | 'en';
  }): Promise<AgentComplianceResponse> {
    this.assertConfig();

    const { framework, question, language: forcedLanguage } = params;
    const language = forcedLanguage ?? this.detectLanguage(question);
    const wantsWeb = this.shouldSearchWeb(question);
    const webSearchPromise = wantsWeb ? this.searchWeb(question) : Promise.resolve([]);

    const instructions = `
You are the chat interface of Tekronyx, a Chat-First GRC & Cybersecurity Compliance platform.

Role:
- Be calm, supportive, honest, and professional but human.
- Do not sound intimidating or bureaucratic.

Language:
- Respond in ${language === 'ar' ? 'Arabic' : 'English'} only.
- Do not mix languages in the same response (except file names or control IDs).

Guidance rules:
- Provide concise compliance guidance and recommended evidence.
- Stay within GRC/cybersecurity compliance.
- If unclear, ask up to 2 clarifying questions (one at a time) before giving detailed steps.
- If the user says they don’t understand, rephrase simply and give a short example.
- Never claim compliance without customer evidence.
- Current framework context: ${this.frameworkLabel(framework, language)}. Do not mention the framework unless the user asks or it is needed to answer accurately. If the user asks about a different framework, ask which one to use.
- Always set complianceSummary.status to "UNKNOWN".
- Because there is no customer evidence here, citations must be an empty array.

Transparency:
- If you reference framework requirements, say it is guidance and not a compliance decision.

Return STRICT JSON only.
Structure:
1) Short acknowledgement.
2) Helpful guidance in 3-5 short sentences.
3) One clear next step or question.
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
                kind: { type: 'string', enum: ['CUSTOMER'] },
              },
            },
          },
          complianceSummary: {
            type: 'object',
            additionalProperties: false,
            required: ['framework', 'status', 'missing', 'recommendations'],
            properties: {
              framework: { type: 'string' },
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
        input: `Framework=${this.frameworkLabel(framework, language)}\nUser question: ${question}\nProvide guidance without claiming compliance.`,
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

      const externalLinks = await webSearchPromise;
      if (wantsWeb) {
        const extra =
          externalLinks.length
            ? `\n\n${this.formatExternalLinks(language, externalLinks)}`
            : language === 'ar'
              ? '\n\nلم أجد نتائج موثوقة عبر البحث. لو عايز مصادر معينة، قولي أسماء الجهات أو المواقع.'
              : '\n\nI could not find reliable results. If you want specific sources, tell me the organizations or sites.';
        parsed.reply = `${parsed.reply}${extra}`;
        parsed.externalLinks = externalLinks.length ? externalLinks : undefined;
      }

      parsed.citations = [];

      if (!parsed.complianceSummary) {
        parsed.complianceSummary = {
          framework: framework ?? null,
          status: 'UNKNOWN',
          missing: [],
          recommendations: [],
        };
      } else {
        parsed.complianceSummary.framework = framework ?? null;
        parsed.complianceSummary.status = 'UNKNOWN';
      }

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[LLM] exception:', msg);

      const reply =
        language === 'ar'
          ? `أنا مساعد امتثال للأمن السيبراني. أقدر أوضح متطلبات ${this.frameworkLabel(framework, language)} وما الأدلة المطلوبة عادةً. ` +
            `لو عايز تقييم امتثال فعلي، من فضلك ارفع الأدلة الخاصة بكم.`
          : `I’m a cybersecurity compliance assistant. I can explain ${this.frameworkLabel(framework, language)} requirements and what evidence is typically needed. ` +
            `To assess your compliance, please upload customer evidence (policies, procedures, screenshots, audit logs, access review records, etc.).`;
      const externalLinks = wantsWeb ? await webSearchPromise : [];
      const extra =
        wantsWeb && externalLinks.length
          ? `\n\n${this.formatExternalLinks(language, externalLinks)}`
          : wantsWeb
            ? language === 'ar'
              ? '\n\nلم أجد نتائج موثوقة عبر البحث. لو عايز مصادر معينة، قولي أسماء الجهات أو المواقع.'
              : '\n\nI could not find reliable results. If you want specific sources, tell me the organizations or sites.'
            : '';

      return {
        reply: reply + extra,
        citations: [],
        externalLinks: externalLinks.length ? externalLinks : undefined,
        complianceSummary: {
          framework: framework ?? null,
          status: 'UNKNOWN',
          missing:
            language === 'ar'
              ? ['لا يوجد مستودع أدلة عميل مرتبط بهذه المحادثة بعد.']
              : ['No customer evidence store is linked to this conversation yet.'],
          recommendations:
            language === 'ar'
              ? [
                  'ارفع مستندات الأدلة (سياسات/إجراءات/أدلة التحكم بالوصول/سجلات تدقيق)',
                  'اسأل سؤال مركز (مثال: التحكم في الوصول: MFA + أقل صلاحيات + مراجعات)',
                ]
              : [
                  'Upload customer evidence documents (policies/procedures/access control docs/audit logs)',
                  'Ask a focused question (e.g., “Access control: MFA + least privilege + provisioning + reviews”)',
                ],
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------
  // 2B) DOCUMENT-LEVEL MATCHING (SINGLE CUSTOMER DOC)
  // ---------------------------
  async analyzeCustomerDocument(params: {
    framework?: string | null;
    fileName: string;
    content?: string | null;
    language?: 'ar' | 'en';
    controlCandidates?: ControlCandidate[];
  }): Promise<DocumentMatchResult> {
    this.assertConfig();

    const { framework, fileName, content, language: forcedLanguage, controlCandidates } = params;
    const language = forcedLanguage ?? this.detectLanguage(content || fileName || '');
    const trimmedContent = (content || '').trim();
    const hasContent = Boolean(trimmedContent);
    const candidates = Array.isArray(controlCandidates) ? controlCandidates : [];
    const allowedIds = new Set<string>();
    const candidateLines = candidates.map((candidate) => {
      const isoList = Array.isArray(candidate.isoMappings)
        ? candidate.isoMappings.map((value) => String(value)).filter(Boolean)
        : [];
      if (candidate.controlCode) {
        allowedIds.add(candidate.controlCode);
      }
      if (isoList.length) {
        isoList.forEach((code) => allowedIds.add(code));
      }
      return `- ${candidate.title} | Code: ${candidate.controlCode} | ISO: ${isoList.join(', ') || '—'}`;
    });
    const allowedList = Array.from(allowedIds);

    if (!hasContent) {
      const fallbackNote =
        language === 'ar'
          ? 'لا يوجد نص قابل للقراءة مرتبط بهذا الملف.'
          : 'No readable document text is available for this file.';
      const fallbackRecs =
        language === 'ar'
          ? ['ارفع ملف PDF/DOCX واضح أو أضف سياقًا أكثر.']
          : ['Upload a readable PDF/DOCX or provide more context.'];
      return {
        docType: language === 'ar' ? 'غير معروف' : 'Unknown',
        matchControlId: null,
        matchStatus: 'UNKNOWN',
        matchNote: fallbackNote,
        matchRecommendations: fallbackRecs,
      };
    }

    const instructions = `
You are a supportive cybersecurity compliance teammate for ${this.frameworkLabel(framework, language)}.
Analyze ONE customer document and decide whether it is valid evidence for a specific control.

Language:
- Respond in ${language === 'ar' ? 'Arabic' : 'English'} only.
- Do not mix languages in the same response (except file names or control IDs).

Rules:
- Use ONLY the provided document content.
- If you cannot identify a control confidently, set matchControlId=null and matchStatus="UNKNOWN".
- If evidence appears sufficient, set matchStatus="COMPLIANT".
- If evidence is partial, set matchStatus="PARTIAL".
- If evidence is unrelated or clearly insufficient, set matchStatus="NOT_COMPLIANT".
- If candidates are provided, you MUST pick matchControlId from the allowed list only.
- If multiple candidates fit, choose the FIRST candidate in the provided list.
- Use the internal control ID when available. ISO codes are references only.
- Keep matchNote short (1-2 sentences), supportive, and non-judgmental.
- Avoid mentioning the framework name unless needed for clarity.
- Provide up to 3 clear, practical recommendations.

Return STRICT JSON only.
`;

    const responseSchema = {
      name: 'document_match',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['docType', 'matchControlId', 'matchStatus', 'matchNote', 'matchRecommendations'],
        properties: {
          docType: { type: 'string' },
          matchControlId: { type: ['string', 'null'] },
          matchStatus: {
            type: 'string',
            enum: ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'],
          },
          matchNote: { type: 'string' },
          matchRecommendations: { type: 'array', items: { type: 'string' } },
        },
      },
    } as const;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const baseInput = [
        `Framework: ${this.frameworkLabel(framework, language)}`,
        `Target file name: ${fileName}`,
        'Analyze the target document only.',
        allowedList.length ? `Allowed control IDs: ${allowedList.join(', ')}` : '',
        candidateLines.length ? `Candidate controls:\n${candidateLines.join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const body: any = {
        model: this.model,
        instructions,
        temperature: 0,
        top_p: 1,
        text: {
          format: {
            type: 'json_schema',
            name: 'document_match',
            schema: responseSchema.schema,
            strict: true,
          },
        },
      };

      body.input = `${baseInput}\n\nDocument content:\n${trimmedContent}`;

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
        console.error('[DOC MATCH] HTTP error', resp.status, JSON.stringify(json)?.slice(0, 2000));
        throw new Error(`OpenAI responses error: ${resp.status}`);
      }

      let outputText: string | undefined = json?.output_text;
      let parsed: DocumentMatchResult | null = null;

      if (typeof outputText === 'string' && outputText.trim().startsWith('{')) {
        parsed = JSON.parse(outputText);
      } else {
        const msg = (json?.output || []).find((x: any) => x?.type === 'message');
        const parts = msg?.content || [];
        const out = parts.find((p: any) => p?.type === 'output_text')?.text;
        if (typeof out === 'string' && out.trim().startsWith('{')) parsed = JSON.parse(out);
      }

      if (!parsed) {
        console.error('[DOC MATCH] Could not parse structured output. Raw=', JSON.stringify(json)?.slice(0, 2000));
        throw new Error('Failed to parse structured output from OpenAI');
      }

      parsed.docType = String(parsed.docType || 'Unknown');
      parsed.matchControlId = parsed.matchControlId ? String(parsed.matchControlId) : null;
      parsed.matchNote = String(parsed.matchNote || '');
      parsed.matchRecommendations = Array.isArray(parsed.matchRecommendations)
        ? parsed.matchRecommendations
        : [];

      if (allowedList.length && parsed.matchControlId) {
        const allowedMap = new Map(allowedList.map((value) => [String(value).toLowerCase(), value]));
        const key = parsed.matchControlId.trim().toLowerCase();
        const normalized = allowedMap.get(key);
        if (normalized) {
          parsed.matchControlId = normalized;
        } else {
          parsed.matchControlId = null;
          parsed.matchStatus = 'UNKNOWN';
          parsed.matchNote =
            language === 'ar'
              ? 'لم أتمكن من مطابقة هذا المستند مع أي كنترول محدد من مرجعنا.'
              : 'Unable to match this document to a specific control in our knowledge base.';
        }
      }

      if (parsed.matchControlId && candidates.length) {
        const candidateByCode = new Map(
          candidates.map((candidate) => [candidate.controlCode.toLowerCase(), candidate]),
        );
        const matchKey = parsed.matchControlId.toLowerCase();
        const direct = candidateByCode.get(matchKey);
        if (direct) {
          parsed.matchControlId = direct.controlCode;
        } else {
          const alias = candidates.find((candidate) =>
            (candidate.isoMappings || []).some((code) => String(code).toLowerCase() === matchKey),
          );
          if (alias) {
            parsed.matchControlId = alias.controlCode;
          }
        }
      }

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[DOC MATCH] exception:', msg);

      return {
        docType: 'Unknown',
        matchControlId: null,
        matchStatus: 'UNKNOWN',
        matchNote: `Document analysis failed: ${msg}`,
        matchRecommendations: ['Try re-uploading the document or provide more context.'],
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------
  // 3) CONTROL-LEVEL EVIDENCE EVALUATION
  // ---------------------------
  async evaluateControlEvidence(params: {
    framework?: string | null;
    control: ControlContext;
    evidenceChunks?: EvidenceChunk[];
    hasCustomerDocs?: boolean;
    language?: 'ar' | 'en';
  }): Promise<AgentControlEvaluation> {
    this.assertConfig();

    const {
      framework,
      control,
      evidenceChunks = [],
      hasCustomerDocs = false,
      language,
    } = params;

    if (!hasCustomerDocs) {
      const languageLabel = language === 'ar' ? 'ar' : 'en';
      return {
        status: 'UNKNOWN',
        summary:
          languageLabel === 'ar'
            ? 'لا توجد أدلة عميل مرتبطة بهذه المحادثة بعد. من فضلك ارفع الأدلة أولًا.'
            : 'No customer evidence is linked to this conversation yet. Please upload evidence documents first.',
        satisfied: [],
        missing: control.testComponents ?? [],
        recommendations:
          languageLabel === 'ar'
            ? ['ارفع أدلة مناسبة للكنترول المطلوب', 'جرّب تقديم سياسات أو إجراءات أو لقطات شاشة أو سجلات تدقيق']
            : [
                'Upload evidence documents that match the requested control',
                'Try providing policies, procedures, screenshots, or audit logs',
              ],
        citations: [],
      };
    }

    if (!evidenceChunks.length) {
      const languageLabel = language === 'ar' ? 'ar' : 'en';
      return {
        status: 'UNKNOWN',
        summary:
          languageLabel === 'ar'
            ? 'لم يتم العثور على أدلة مرتبطة بهذا الكنترول ضمن الملفات المرفوعة.'
            : 'No evidence linked to this control was found in the uploaded documents.',
        satisfied: [],
        missing: control.testComponents ?? [],
        recommendations:
          languageLabel === 'ar'
            ? ['ارفع أدلة أكثر تحديدًا للكنترول المطلوب', 'أضف سجلات أو لقطات شاشة توضح التطبيق العملي']
            : [
                'Upload more specific evidence for this control',
                'Add logs or screenshots that show implementation in practice',
              ],
        citations: [],
      };
    }

    const languageLabel = language === 'ar' ? 'Arabic' : 'English';

    const instructions = `
You are a supportive cybersecurity compliance teammate.
Evaluate CUSTOMER evidence for the given control.

Language:
- Respond in ${languageLabel}.

Rules:
- Use ONLY the provided CUSTOMER evidence snippets.
- The provided control criteria are signals, not rigid rules. Use judgment and explain gaps clearly.
- If evidence is missing or irrelevant, status MUST be "UNKNOWN".
- Avoid judgmental/pass-fail language. Be honest and action-oriented.
- Summary must include a short transparency note (e.g. "Based on your uploaded evidence and our internal control criteria.").
- Be concise and list which test components are satisfied vs missing.
- Return STRICT JSON only.
`;

    const responseSchema = {
      name: 'control_evaluation',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'summary', 'satisfied', 'missing', 'recommendations', 'citations'],
        properties: {
          status: {
            type: 'string',
            enum: ['COMPLIANT', 'PARTIAL', 'NOT_COMPLIANT', 'UNKNOWN'],
          },
          summary: { type: 'string' },
          satisfied: { type: 'array', items: { type: 'string' } },
          missing: { type: 'array', items: { type: 'string' } },
          recommendations: { type: 'array', items: { type: 'string' } },
          citations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['doc', 'page', 'kind'],
              properties: {
                doc: { type: 'string' },
                page: { type: ['number', 'null'] },
                kind: { type: 'string', enum: ['CUSTOMER'] },
              },
            },
          },
        },
      },
    } as const;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    try {
      const context = [
        `Framework: ${this.frameworkLabel(framework, language)}`,
        `Control: ${control.id} — ${control.title}`,
        `Summary: ${control.summary}`,
        `Evidence needed: ${(control.evidence || []).join('; ')}`,
        `Test components: ${(control.testComponents || []).join('; ')}`,
      ].join('\n');

      const evidenceText = this.formatEvidenceChunks(evidenceChunks);
      const allowedDocs = new Set(
        evidenceChunks.map((chunk) => String(chunk.docName || '').trim()).filter(Boolean),
      );

      const body = {
        model: this.model,
        instructions,
        input: `${context}\n\nCustomer evidence snippets:\n${evidenceText}`,
        text: {
          format: {
            type: 'json_schema',
            name: 'control_evaluation',
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
        console.error('[CONTROL EVAL] HTTP error', resp.status, JSON.stringify(json)?.slice(0, 2000));
        throw new Error(`OpenAI responses error: ${resp.status}`);
      }

      let outputText: string | undefined = json?.output_text;
      let parsed: AgentControlEvaluation | null = null;

      if (typeof outputText === 'string' && outputText.trim().startsWith('{')) {
        parsed = JSON.parse(outputText);
      } else {
        const msg = (json?.output || []).find((x: any) => x?.type === 'message');
        const parts = msg?.content || [];
        const out = parts.find((p: any) => p?.type === 'output_text')?.text;
        if (typeof out === 'string' && out.trim().startsWith('{')) parsed = JSON.parse(out);
      }

      if (!parsed) {
        console.error('[CONTROL EVAL] Could not parse structured output. Raw=', JSON.stringify(json)?.slice(0, 2000));
        throw new Error('Failed to parse structured output from OpenAI');
      }

      parsed.satisfied = Array.isArray(parsed.satisfied) ? parsed.satisfied : [];
      parsed.missing = Array.isArray(parsed.missing) ? parsed.missing : [];
      parsed.recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
      parsed.citations = this.filterCitationsByDocs(
        Array.isArray(parsed.citations) ? parsed.citations : [],
        allowedDocs,
      );

      return parsed;
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'OpenAI request timed out' : e?.message || String(e);
      console.error('[CONTROL EVAL] exception:', msg);

      const languageLabel = language === 'ar' ? 'ar' : 'en';
      return {
        status: 'UNKNOWN',
        summary:
          languageLabel === 'ar'
            ? `فشل تقييم الدليل: ${msg}`
            : `Evidence evaluation failed: ${msg}`,
        satisfied: [],
        missing: control.testComponents ?? [],
        recommendations:
          languageLabel === 'ar'
            ? ['تأكد من OPENAI_API_KEY وإعدادات استخراج النص', 'ارفع الأدلة بصيغ PDF/DOCX/صور وأعد المحاولة']
            : [
                'Verify OPENAI_API_KEY and text extraction setup',
                'Upload evidence in PDF/DOCX/image formats and retry',
              ],
        citations: [],
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
