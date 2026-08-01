/**
 * Provider registry. Selecting a backend is a lookup here; adding a provider
 * (e.g. OpenAI) means registering its adapter, with no change to the UI.
 */
import { claudeProvider } from "./providers/claude.js";
import type { AgentProvider, AgentSession, AgentSessionOptions } from "./types.js";

export * from "./types.js";

const providers: Record<string, AgentProvider> = {
  [claudeProvider.id]: claudeProvider,
};

export function getProvider(id: string): AgentProvider {
  const provider = providers[id];
  if (!provider) {
    const known = Object.keys(providers).join(", ");
    throw new Error(`Unknown provider "${id}". Available: ${known}`);
  }
  return provider;
}

export function createSession(
  providerId: string,
  options: AgentSessionOptions,
): AgentSession {
  return getProvider(providerId).createSession(options);
}
