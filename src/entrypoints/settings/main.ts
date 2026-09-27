// §12.4: backend/provider selection UI. Custom (openai-compatible) base
// URLs and custom agent server endpoints (M11, §12.3) need a runtime host
// permission grant (§12.4, §4.3.8) -- Groq's and OpenRouter's fixed hosts
// are already covered by the manifest's static host_permissions. M11 added the §9.4 model
// override for face; M12 extends it to every capability (src/models/catalog.ts).

import { getBackendSettings, parseHttpEndpoint, setBackendSettings } from '@/backend';
// The settings module directly, not '@/models': the barrel also pulls in the
// registry and every provider, which this page never uses.
import { MODEL_CATALOG } from '@/models/catalog';
import type { Capability } from '@/models/capabilities';
import { getModelSettings, setModelSettings } from '@/models/settings';
import { getPlatform } from '@/platform';

const platform = getPlatform();

const backendSelect = document.getElementById('backend') as HTMLSelectElement;
const groqKeyInput = document.getElementById('groq-key') as HTMLInputElement;
const groqModelInput = document.getElementById('groq-model') as HTMLInputElement;
const openrouterKeyInput = document.getElementById('openrouter-key') as HTMLInputElement;
const openrouterModelInput = document.getElementById('openrouter-model') as HTMLInputElement;
const oacBaseUrlInput = document.getElementById('oac-base-url') as HTMLInputElement;
const oacKeyInput = document.getElementById('oac-key') as HTMLInputElement;
const oacModelInput = document.getElementById('oac-model') as HTMLInputElement;
const httpEndpointInput = document.getElementById('http-endpoint') as HTMLInputElement;
const httpTokenInput = document.getElementById('http-token') as HTMLInputElement;
const modelSelectsEl = document.getElementById('model-selects') as HTMLDivElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

// One labelled select per capability: "Automatic" (no override, value '')
// and then each provider in the registry's preference order.
const modelSelects = new Map<Capability, HTMLSelectElement>();
for (const entry of MODEL_CATALOG) {
  const label = document.createElement('label');
  label.htmlFor = `model-${entry.capability}`;
  label.textContent = entry.label;
  const select = document.createElement('select');
  select.id = `model-${entry.capability}`;
  for (const { id, label: text } of [{ id: '', label: entry.automatic }, ...entry.options]) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = text;
    select.append(option);
  }
  modelSelectsEl.append(label, select);
  modelSelects.set(entry.capability, select);
}

async function load(): Promise<void> {
  const settings = await getBackendSettings(platform.settings);
  backendSelect.value = settings.selectedBackendId;
  groqKeyInput.value = settings.llm.groq?.apiKey ?? '';
  groqModelInput.value = settings.llm.groq?.model ?? '';
  openrouterKeyInput.value = settings.llm.openrouter?.apiKey ?? '';
  openrouterModelInput.value = settings.llm.openrouter?.model ?? '';
  oacBaseUrlInput.value = settings.llm['openai-compatible']?.baseUrl ?? '';
  oacKeyInput.value = settings.llm['openai-compatible']?.apiKey ?? '';
  oacModelInput.value = settings.llm['openai-compatible']?.model ?? '';
  httpEndpointInput.value = settings.http?.endpoint ?? '';
  httpTokenInput.value = settings.http?.token ?? '';
  const { overrides } = await getModelSettings(platform.settings);
  for (const [capability, select] of modelSelects) select.value = overrides[capability] ?? '';
}

saveButton.addEventListener('click', () => {
  void (async () => {
    statusEl.textContent = '';

    // permissions.request() only prompts when called before any other
    // await in the click handler (CLAUDE.md browser quirks), so each branch
    // calls it first.
    if (backendSelect.value === 'llm:openai-compatible' && oacBaseUrlInput.value.trim()) {
      const granted = await platform.requestHostPermission(new URL(oacBaseUrlInput.value.trim()).origin + '/*');
      if (!granted) {
        statusEl.textContent = 'Host permission for that URL was not granted -- backend will not start.';
      }
    } else if (backendSelect.value === 'http:custom') {
      const endpoint = parseHttpEndpoint(httpEndpointInput.value);
      if (!endpoint) {
        statusEl.textContent = 'The endpoint must be an HTTPS URL (or http://localhost / http://127.0.0.1) with no query or credentials.';
        return;
      }
      // Port-less pattern: match patterns without a port match every port,
      // and the manifest's optional hosts are declared that way.
      const { protocol, hostname } = new URL(endpoint);
      const granted = await platform.requestHostPermission(`${protocol}//${hostname}/*`);
      if (!granted) {
        statusEl.textContent = 'Host permission for that endpoint was not granted -- backend will not start.';
      }
    }

    await setBackendSettings(platform.settings, {
      selectedBackendId: backendSelect.value,
      llm: {
        groq: { apiKey: groqKeyInput.value, model: groqModelInput.value || undefined },
        openrouter: { apiKey: openrouterKeyInput.value, model: openrouterModelInput.value || undefined },
        'openai-compatible': {
          apiKey: oacKeyInput.value,
          baseUrl: oacBaseUrlInput.value || undefined,
          model: oacModelInput.value || undefined,
        },
      },
      http: httpEndpointInput.value.trim() ? { endpoint: httpEndpointInput.value.trim(), token: httpTokenInput.value || undefined } : undefined,
    });
    const overrides: Partial<Record<Capability, string>> = {};
    for (const [capability, select] of modelSelects) if (select.value) overrides[capability] = select.value;
    await setModelSettings(platform.settings, { overrides });

    statusEl.textContent = statusEl.textContent || 'Saved.';
  })();
});

void load();
