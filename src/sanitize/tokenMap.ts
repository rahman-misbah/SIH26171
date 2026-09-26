// §7.6: the token map. Lives only in compute-host memory (never persisted,
// logged, or placed in a SanitizedObservation) -- one instance per agent
// session, created lazily by whoever owns sessions (src/core/computeHost.ts
// for M5; the agent loop from M6 on). Cleared when the session ends.

import type { PiiType, TokenMapEntry, TokenSource } from './types';

export interface TokenizeInput {
  type: PiiType;
  value: string;
  origin: string;
  source: TokenSource;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export class TokenMapImpl {
  private readonly byKey = new Map<string, TokenMapEntry>();
  private readonly byToken = new Map<string, TokenMapEntry>();
  private readonly counters = new Map<PiiType, number>();

  // Stable per (origin, type, normalized value) for the whole session (§7.6).
  tokenize(input: TokenizeInput): string {
    const key = `${input.origin} ${input.type} ${normalize(input.value)}`;
    const existing = this.byKey.get(key);
    if (existing) {
      existing.sources.push(input.source);
      return existing.token;
    }

    const n = (this.counters.get(input.type) ?? 0) + 1;
    this.counters.set(input.type, n);
    const token = `[PII_${input.type}_${n}]`;

    const entry: TokenMapEntry = {
      token,
      type: input.type,
      value: input.value,
      origin: input.origin,
      sources: [input.source],
      created_at: Date.now(),
    };
    this.byKey.set(key, entry);
    this.byToken.set(token, entry);
    return token;
  }

  // M12: the raw values tokenized on `origin`, for the known-value pass
  // (knownValues.ts). Compute-host memory only, like the rest of the map.
  knownValues(origin: string): { type: PiiType; value: string }[] {
    return [...this.byToken.values()].filter((e) => e.origin === origin).map((e) => ({ type: e.type, value: e.value }));
  }

  resolve(token: string): string | undefined {
    return this.byToken.get(token)?.value;
  }

  entryForToken(token: string): TokenMapEntry | undefined {
    return this.byToken.get(token);
  }
}
