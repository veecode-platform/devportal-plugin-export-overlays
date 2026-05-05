/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { HttpAuthService, LoggerService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import express from 'express';
import Router from 'express-promise-router';
import { validate as uuidValidate } from 'uuid';
import { MCPClientService } from '../services/MCPClientService';
import { ChatConversationStore } from '../services/ChatConversationStore';
import { SummarizationService } from '../services/SummarizationService';
import { validateMessages, isGuestUser } from '../utils';

export interface ChatRoutesDeps {
  mcpClientService: MCPClientService;
  conversationStore: ChatConversationStore;
  summarizationService: SummarizationService;
  httpAuth: HttpAuthService;
  logger: LoggerService;
}

export function createChatRoutes(deps: ChatRoutesDeps): express.Router {
  const {
    mcpClientService,
    conversationStore,
    summarizationService,
    httpAuth,
    logger,
  } = deps;
  const router = Router();

  router.post('/', async (req, res) => {
    const { messages, enabledTools, conversationId } = req.body;

    if (conversationId && !uuidValidate(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID format' });
    }

    const validation = validateMessages(messages);
    if (!validation.isValid) {
      logger.warn(`Message validation failed: ${validation.error}`);
      return res.status(400).json({ error: validation.error });
    }

    if (enabledTools && !Array.isArray(enabledTools)) {
      throw new InputError('enabledTools must be an array');
    }

    if (
      enabledTools &&
      enabledTools.some((tool: any) => typeof tool !== 'string')
    ) {
      throw new InputError('All enabledTools must be strings');
    }

    const credentials = await httpAuth.credentials(req, {
      allow: ['user'],
      allowLimitedAccess: true,
    });

    const { reply, toolCalls, toolResponses } =
      await mcpClientService.processQuery(messages, enabledTools, credentials);

    const toolsUsed =
      toolCalls.length > 0 ? toolCalls.map(call => call.function.name) : [];

    const conversationMessages = [
      ...messages,
      {
        role: 'assistant' as const,
        content: reply,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    ];

    let savedConversationId: string | undefined;
    let userId: string | undefined;
    try {
      userId = credentials.principal.userEntityRef;

      if (!isGuestUser(userId)) {
        const savedConversation = await conversationStore.saveConversation(
          userId,
          conversationMessages,
          toolsUsed.length > 0 ? toolsUsed : undefined,
          conversationId,
        );
        savedConversationId = savedConversation.id;

        if (savedConversationId && !conversationId) {
          const convId = savedConversationId;
          const convUserId = userId;

          setImmediate(async () => {
            try {
              const title = await summarizationService.summarizeConversation(
                conversationMessages,
              );

              await conversationStore.updateTitle(convUserId, convId, title);

              logger.debug(
                `Generated title for conversation ${convId}: "${title}"`,
              );
            } catch (titleError) {
              logger.warn(
                `Failed to generate title for ${convId}: ${titleError}`,
              );
            }
          });
        }
      }
    } catch (error: any) {
      if (error?.message?.includes('no such table')) {
        logger.warn('Conversations table does not exist yet');
      } else {
        logger.error(`Failed to save conversation: ${error}`);
      }
    }

    return res.json({
      role: 'assistant',
      content: reply,
      toolResponses: toolCalls.length > 0 ? toolResponses : [],
      toolsUsed,
      conversationId: savedConversationId,
    });
  });

  return router;
}
