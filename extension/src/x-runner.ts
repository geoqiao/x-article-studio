import { runArticleDraft } from './runner-core.js';
import { RUNNER_GLOBAL } from './protocol.js';

function installRunner(): void {
  const page = window as unknown as Record<string, unknown>;
  if (typeof page[RUNNER_GLOBAL] === 'function') return;
  Object.defineProperty(page, RUNNER_GLOBAL, {
    value: (input: unknown) => runArticleDraft(input),
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

installRunner();
