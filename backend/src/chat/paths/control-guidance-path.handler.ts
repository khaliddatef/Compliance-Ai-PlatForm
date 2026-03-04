import { Injectable } from '@nestjs/common';
import { ControlKbService } from '../../control-kb/control-kb.service';
import type { AuthUser } from '../../auth/auth.service';
import { ChatIntentService } from './chat-intent.service';

@Injectable()
export class ControlGuidancePathHandler {
  constructor(
    private readonly controlKb: ControlKbService,
    private readonly intent: ChatIntentService,
  ) {}

  async tryBuildDirectControlTestComponentsReply(params: {
    prompt: string;
    language?: 'ar' | 'en';
    user: AuthUser;
  }) {
    const prompt = String(params.prompt || '').trim();
    if (!prompt || !this.intent.isTestComponentsPrompt(prompt)) return null;

    const control = await this.resolveControlContextFromPrompt(prompt, params.user);
    if (!control) return null;

    const language = this.intent.resolveReplyLanguage(params.language, prompt);
    const title = `${control.id} — ${control.title}`;
    const components = Array.isArray(control.testComponents)
      ? control.testComponents.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    if (!components.length) {
      const reply =
        language === 'ar'
          ? `عناصر الاختبار للكنترول ${title} غير متاحة حاليًا في قاعدة المعرفة.`
          : `Test components for control ${title} are currently not available in Control KB.`;
      return { reply };
    }

    const header =
      language === 'ar'
        ? `عناصر الاختبار للكنترول ${title}:`
        : `Test components for control ${title}:`;
    const lines = components.map((item, index) => `${index + 1}. ${item}`);
    return { reply: [header, ...lines].join('\n') };
  }

  private async resolveControlContextFromPrompt(prompt: string, user: AuthUser) {
    const includeDisabled = user?.role === 'ADMIN';
    const codeCandidates = this.extractControlCodeCandidates(prompt);
    for (const candidate of codeCandidates) {
      const context = await this.controlKb.getControlContextByCode({
        controlCode: candidate,
        includeDisabled,
      });
      if (context) return context;
    }

    const catalog = await this.controlKb.listControlCatalog();
    if (!catalog.length) return null;

    const promptTokens = new Set(this.tokenizeForControlMatch(prompt));
    const promptNormalized = this.normalizeForControlMatch(prompt);
    let best: { id: string; score: number } | null = null;

    for (const item of catalog) {
      const id = String(item?.id || '').trim();
      const title = String(item?.title || '').trim();
      if (!id || !title) continue;

      const idLower = id.toLowerCase();
      const titleLower = title.toLowerCase();
      if (promptNormalized.includes(idLower)) {
        best = { id, score: 100 };
        break;
      }

      const titleTokens = this.tokenizeForControlMatch(title);
      if (!titleTokens.length) continue;

      const overlap = titleTokens.filter((token) => promptTokens.has(token)).length;
      const ratio = overlap / titleTokens.length;
      let score = ratio;
      if (promptNormalized.includes(titleLower)) {
        score += 1.5;
      }
      if (overlap >= 2) {
        score += 0.4;
      }

      if (!best || score > best.score) {
        best = { id, score };
      }
    }

    if (!best || best.score < 0.9) return null;
    return this.controlKb.getControlContextByCode({
      controlCode: best.id,
      includeDisabled,
    });
  }

  private extractControlCodeCandidates(prompt: string) {
    const input = String(prompt || '');
    const candidates = new Set<string>();

    const isoLikeMatches = input.match(/\b[aA]\.\d+(?:\.\d+)*\b/g) || [];
    isoLikeMatches.forEach((value) => candidates.add(value.toUpperCase()));

    const govLikeMatches = input.match(/\b[A-Za-z]{2,}\s*-\s*\d{1,4}\b/g) || [];
    govLikeMatches.forEach((value) =>
      candidates.add(value.replace(/\s+/g, '').toUpperCase()),
    );

    return Array.from(candidates);
  }

  private normalizeForControlMatch(value: string) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s.-]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenizeForControlMatch(value: string) {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'what',
      'are',
      'is',
      'of',
      'control',
      'components',
      'test',
      'explain',
      'can',
      'you',
      'عن',
      'من',
      'في',
      'على',
      'ما',
      'هو',
      'هي',
      'ايه',
      'إيه',
      'الكنترول',
      'كنترول',
      'عناصر',
      'اختبار',
      'مكونات',
    ]);

    return this.normalizeForControlMatch(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !stopWords.has(token));
  }
}
