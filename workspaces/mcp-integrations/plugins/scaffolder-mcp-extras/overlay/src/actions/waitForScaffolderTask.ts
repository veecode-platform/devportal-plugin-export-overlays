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

export type Failure = {
  name: string;
  message: string;
  status?: number;
};

type TaskEvent = {
  id: number;
  type: string;
  body: Record<string, unknown>;
};

export type TaskOutcome =
  | { kind: 'succeeded'; lastEventId: number; output?: Record<string, unknown> }
  | { kind: 'failed'; lastEventId: number; failure: Failure; stepId?: string }
  | { kind: 'cancelled'; lastEventId: number }
  | { kind: 'still-running'; lastEventId: number }
  | { kind: 'poll-failed'; lastEventId: number; failure: Failure };

// The backend writes this message for a run that completed without output
// (StorageTaskBroker.complete). A stale run completes with another message and
// no error, so the message is what tells a success from a stale run.
const COMPLETED_MESSAGE = 'Run completed with status: completed';

const NAME_BY_STATUS: Partial<Record<number, string>> = {
  400: 'InputError',
  401: 'AuthenticationError',
  403: 'NotAllowedError',
  404: 'NotFoundError',
  409: 'ConflictError',
  503: 'ServiceUnavailableError',
};

const SCAFFOLD_STATUS = /^Backend request failed, (\d{3}) /;

// The events endpoint holds an idle request, but a proxy or another backend can
// answer an empty list at once. Each poll takes at least this long, so an empty
// answer cannot turn the loop into a request flood.
const MIN_POLL_INTERVAL_MS = 1_000;

/**
 * Polls the task's events until a completion or cancellation event arrives, or
 * until the deadline passes. The events endpoint long-polls for up to 30
 * seconds, so every request is aborted at the deadline.
 */
export async function waitForScaffolderTask(options: {
  baseUrl: string;
  taskId: string;
  deadline: number;
  getToken: () => Promise<string>;
}): Promise<TaskOutcome> {
  let lastEventId = 0;
  let failedStepId: string | undefined;

  for (;;) {
    const startedAt = Date.now();
    const left = options.deadline - startedAt;
    if (left <= 0) {
      return { kind: 'still-running', lastEventId };
    }

    const signal = AbortSignal.timeout(left);
    let events: TaskEvent[];
    try {
      const token = await abortable(options.getToken(), signal);
      const url = new URL(
        `v2/tasks/${options.taskId}/events`,
        `${options.baseUrl}/`,
      );
      if (lastEventId > 0) {
        url.searchParams.set('after', String(lastEventId));
      }
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return {
          kind: 'poll-failed',
          lastEventId,
          failure: failureForResponse(response),
        };
      }
      events = parseEvents(await response.json());
    } catch (error) {
      if (signal.aborted) {
        return { kind: 'still-running', lastEventId };
      }
      return {
        kind: 'poll-failed',
        lastEventId,
        failure: describeFailure(error),
      };
    }

    if (events.length === 0) {
      await pauseBeforeNextPoll(startedAt, options.deadline);
    }

    for (const event of events) {
      lastEventId = Math.max(lastEventId, event.id);
      // The run's error belongs to the first failed step: a step that runs
      // after a failure, such as one guarded by failure() or always(), can fail
      // too.
      if (
        event.type === 'log' &&
        event.body.status === 'failed' &&
        typeof event.body.stepId === 'string'
      ) {
        failedStepId ??= event.body.stepId;
      }
      if (event.type === 'cancelled') {
        return { kind: 'cancelled', lastEventId };
      }
      if (event.type === 'completion') {
        return completionOutcome(event.body, lastEventId, failedStepId);
      }
    }
  }
}

function pauseBeforeNextPoll(
  startedAt: number,
  deadline: number,
): Promise<void> {
  const pause = Math.min(
    MIN_POLL_INTERVAL_MS - (Date.now() - startedAt),
    deadline - Date.now(),
  );
  if (pause <= 0) {
    return Promise.resolve();
  }
  return new Promise<void>(resolve => setTimeout(resolve, pause));
}

export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export function isKnownFailure(failure: Failure): boolean {
  return (
    failure.status !== undefined && NAME_BY_STATUS[failure.status] !== undefined
  );
}

export function describeFailure(error: unknown): Failure {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: String(error) };
  }
  // ScaffolderClient.scaffold throws a plain Error for a non-201 response, and
  // its message starts with the HTTP status. Until it throws a typed error,
  // the status is read from that prefix; a message that does not match keeps
  // its own name, which the caller treats as an unknown failure.
  const statusText = SCAFFOLD_STATUS.exec(error.message)?.[1];
  if (statusText === undefined) {
    return { name: error.name, message: error.message };
  }
  const status = Number(statusText);
  return {
    name: NAME_BY_STATUS[status] ?? 'Error',
    message: error.message,
    status,
  };
}

function failureForResponse(response: Response): Failure {
  return {
    name: NAME_BY_STATUS[response.status] ?? 'Error',
    message: `Events request failed with ${response.status} ${response.statusText}`,
    status: response.status,
  };
}

function completionOutcome(
  body: Record<string, unknown>,
  lastEventId: number,
  failedStepId: string | undefined,
): TaskOutcome {
  if (body.error !== undefined) {
    return {
      kind: 'failed',
      lastEventId,
      failure: failureFromBody(body.error),
      stepId: failedStepId,
    };
  }
  if (isRecord(body.output)) {
    return { kind: 'succeeded', lastEventId, output: body.output };
  }
  if (body.message === COMPLETED_MESSAGE) {
    return { kind: 'succeeded', lastEventId };
  }
  return {
    kind: 'failed',
    lastEventId,
    failure: {
      name: 'Error',
      message:
        typeof body.message === 'string'
          ? body.message
          : 'The run ended without a result',
    },
    stepId: failedStepId,
  };
}

function failureFromBody(error: unknown): Failure {
  if (!isRecord(error)) {
    return { name: 'Error', message: 'The run failed' };
  }
  return {
    name: typeof error.name === 'string' ? error.name : 'Error',
    message:
      typeof error.message === 'string' ? error.message : 'The run failed',
  };
}

function parseEvents(json: unknown): TaskEvent[] {
  if (Array.isArray(json) && json.every(isTaskEvent)) {
    return json;
  }
  throw new Error('The events response is not a list of task events');
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.type === 'string' &&
    isRecord(value.body)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
