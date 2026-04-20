/*
 * Copyright 2025 VeeCode.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

import type { LoggerService } from '@backstage/backend-plugin-api';
import type { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { CARDS, ROUTER_MD } from './knowledge';

const SUPPORTED_CONCEPTS = Object.keys(CARDS);

/**
 * Registers the `explain(concept)` MCP action.
 *
 * The action is a pure dispatcher over a static corpus (see `./knowledge.ts`). It does
 * no natural-language understanding — it assumes the LLM client has already normalized
 * the user's question into one of the canonical concept strings, or passed `''` to ask
 * for routing guidance only.
 *
 * Response shape:
 *  - recognized concept -> ROUTER_MD + card
 *  - empty string       -> ROUTER_MD (use the platform framing / ambiguity branches)
 *  - unknown string     -> ROUTER_MD, with `recognized: false` so the caller can tell
 *
 * @public
 */
export const createExplainAction = ({
  registry,
  logger,
}: {
  registry: ActionsRegistryService;
  logger: LoggerService;
}) => {
  registry.register({
    name: 'explain',
    title: 'Explain a DevPortal/Backstage concept',
    description: [
      'Return an explanation of a core DevPortal/Backstage concept, grounded in a static corpus.',
      '',
      `Supported concepts: ${SUPPORTED_CONCEPTS.join(', ')}.`,
      '',
      'Call with `concept` set to one of the supported strings to receive that concept card plus router guidance.',
      'Call with `concept: ""` (empty string) to receive only the router guidance — use this when the user question is a meta-question, ambiguous, out of scope, or contains a false premise.',
      'Any other string returns the router guidance with `recognized: false`.',
    ].join('\n'),
    schema: {
      input: (z: any) =>
        z.object({
          concept: z
            .string()
            .describe(
              `One of ${SUPPORTED_CONCEPTS.map(c => `"${c}"`).join(', ')}, or "" (empty) for routing guidance only.`,
            ),
        }),
      output: (z: any) =>
        z.object({
          concept: z
            .string()
            .describe(
              'The normalized concept key resolved by the dispatcher (lowercased, trimmed). Empty string if the caller passed "".',
            ),
          recognized: z
            .boolean()
            .describe(
              'True if the concept matched a supported card; false for unknown strings. Empty input returns true (known no-op case).',
            ),
          content: z
            .string()
            .describe(
              'Markdown content: router guidance alone when no card matched, otherwise router guidance followed by the concept card.',
            ),
        }),
    },
    action: async ({ input }: { input: { concept: string } }) => {
      const key = (input.concept ?? '').trim().toLowerCase();
      const card = CARDS[key];

      if (card) {
        return {
          output: {
            concept: key,
            recognized: true,
            content: `${ROUTER_MD}\n\n---\n\n${card}`,
          },
        };
      }

      if (key === '') {
        return {
          output: {
            concept: '',
            recognized: true,
            content: ROUTER_MD,
          },
        };
      }

      logger.debug(
        `explain: unrecognized concept=${JSON.stringify(input.concept)}`,
      );
      return {
        output: {
          concept: key,
          recognized: false,
          content: ROUTER_MD,
        },
      };
    },
  });
};
