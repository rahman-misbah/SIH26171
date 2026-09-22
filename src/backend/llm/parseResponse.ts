// §12.2: "extract the first JSON object [from the model's raw text] and
// validate against §13.1". A brace-counting, string-aware scanner rather
// than a regex, because thinking-mode models (Groq's Qwen) wrap the JSON in
// reasoning text that can itself contain unbalanced braces.

import { isAgentResponse, type AgentResponse } from '@/agent/schema';

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === '\\') escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined; // unbalanced -- truncated response
}

export function parseAgentResponse(text: string): AgentResponse | undefined {
  const jsonText = extractFirstJsonObject(text);
  if (!jsonText) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return undefined;
  }
  return isAgentResponse(parsed) ? parsed : undefined;
}
