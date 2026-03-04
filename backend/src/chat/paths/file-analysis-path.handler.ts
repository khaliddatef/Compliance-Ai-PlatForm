import { Injectable } from '@nestjs/common';
import { ChatService, RagHit } from '../chat.service';
import { ChatIntentService } from './chat-intent.service';
import type { ChatPath } from './chat-path.types';

@Injectable()
export class FileAnalysisPathHandler {
  constructor(
    private readonly chatService: ChatService,
    private readonly intent: ChatIntentService,
  ) {}

  async selectEvidenceChunks(params: {
    conversationId: string;
    prompt: string;
    docCount: number;
    routePath: ChatPath;
    topChunks: RagHit[];
    mentionedChunks: RagHit[];
  }): Promise<RagHit[]> {
    const { conversationId, prompt, docCount, routePath, topChunks, mentionedChunks } = params;
    if (mentionedChunks.length) return mentionedChunks;

    const preferLatestDocOnly = routePath === 'FILE_ANALYSIS';
    if (
      docCount > 0
      && !this.intent.isSmallTalkPrompt(prompt, { hasCustomerDocs: true, lastRoute: routePath })
      && preferLatestDocOnly
    ) {
      const latestDocChunks = await this.chatService.retrieveLatestDocumentChunks({
        conversationId,
        kind: 'CUSTOMER',
        topK: 12,
      });
      if (latestDocChunks.length) {
        return latestDocChunks;
      }
    }

    return topChunks;
  }
}
