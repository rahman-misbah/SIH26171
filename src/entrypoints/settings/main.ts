// §12.4: backend/provider selection UI. Custom (openai-compatible) base
// URLs need a runtime host permission grant (§12.4, §4.3.8) -- Groq's fixed
// host is already covered by the manifest's static host_permissions.

import { getBackendSettings, setBackendSettings } from '@/backend';
import { getPlatform } from '@/platform';

const platform = getPlatform();

const backendSelect = document.getElementById('backend') as HTMLSelectElement;
const groqKeyInput = document.getElementById('groq-key') as HTMLInputElement;
const groqModelInput = document.getElementById('groq-model') as HTMLInputElement;
const oacBaseUrlInput = document.getElementById('oac-base-url') as HTMLInputElement;
const oacKeyInput = document.getElementById('oac-key') as HTMLInputElement;
const oacModelInput = document.getElementById('oac-model') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function load(): Promise<void> {
  const settings = await getBackendSettings(platform.settings);
  backendSelect.value = settings.selectedBackendId;
  groqKeyInput.value = settings.llm.groq?.apiKey ?? '';
  groqModelInput.value = settings.llm.groq?.model ?? '';
  oacBaseUrlInput.value = settings.llm['openai-compatible']?.baseUrl ?? '';
  oacKeyInput.value = settings.llm['openai-compatible']?.apiKey ?? '';
  oacModelInput.value = settings.llm['openai-compatible']?.model ?? '';
}

saveButton.addEventListener('click', () => {
  void (async () => {
    statusEl.textContent = '';

    if (backendSelect.value === 'llm:openai-compatible' && oacBaseUrlInput.value.trim()) {
      const granted = await platform.requestHostPermission(new URL(oacBaseUrlInput.value.trim()).origin + '/*');
      if (!granted) {
        statusEl.textContent = 'Host permission for that URL was not granted -- backend will not start.';
      }
    }

    await setBackendSettings(platform.settings, {
      selectedBackendId: backendSelect.value,
      llm: {
        groq: { apiKey: groqKeyInput.value, model: groqModelInput.value || undefined },
        'openai-compatible': {
          apiKey: oacKeyInput.value,
          baseUrl: oacBaseUrlInput.value || undefined,
          model: oacModelInput.value || undefined,
        },
      },
    });

    statusEl.textContent = statusEl.textContent || 'Saved.';
  })();
});

void load();
