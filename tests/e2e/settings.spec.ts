// M12 (§9.4): the settings page offers a model override for every
// capability, built from src/models/catalog.ts, and saves the choices as
// provider ids in `edward.modelSettings`.

import { expect, test } from './fixtures';

test('settings page lists every capability and saves model overrides', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/settings.html`);

  for (const capability of ['face', 'ocr', 'qr', 'ner']) {
    const select = page.locator(`#model-${capability}`);
    await expect(select).toBeVisible();
    await expect(select.locator('option').first()).toHaveAttribute('value', '');
  }

  await page.selectOption('#model-face', 'face/blazeface-mediapipe');
  await page.selectOption('#model-ner', 'ner/gravitee-bert-small-pii');
  await page.click('#save');
  await expect(page.locator('#status')).toHaveText('Saved.');

  await page.reload();
  await expect(page.locator('#model-face')).toHaveValue('face/blazeface-mediapipe');
  await expect(page.locator('#model-ner')).toHaveValue('ner/gravitee-bert-small-pii');
  await expect(page.locator('#model-ocr')).toHaveValue('');
});

// M12 F11 (§12.4): OpenRouter is a selectable backend with its own key and
// model fields. Its host is a static host_permission, so saving needs no prompt.
test('settings page saves and reloads the OpenRouter backend', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/settings.html`);

  await page.selectOption('#backend', 'llm:openrouter');
  await page.fill('#openrouter-key', 'sk-or-test-not-a-real-key');
  await page.fill('#openrouter-model', 'google/gemini-3.8-flash');
  await page.click('#save');
  await expect(page.locator('#status')).toHaveText('Saved.');

  await page.reload();
  await expect(page.locator('#backend')).toHaveValue('llm:openrouter');
  await expect(page.locator('#openrouter-key')).toHaveValue('sk-or-test-not-a-real-key');
  await expect(page.locator('#openrouter-model')).toHaveValue('google/gemini-3.8-flash');
});
