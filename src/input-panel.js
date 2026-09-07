const elements = {
  closeButton: document.querySelector('#closeButton'),
  copyButton: document.querySelector('#copyButton'),
  panelTitle: document.querySelector('#panelTitle'),
  providerText: document.querySelector('#providerText'),
  resultText: document.querySelector('#resultText'),
  sourceInput: document.querySelector('#sourceInput'),
  statusText: document.querySelector('#statusText'),
  targetLanguageSelect: document.querySelector('#targetLanguageSelect'),
};

let translateSequence = 0;
let debounceTimer = null;
let lastTranslation = '';
let settings = null;

const SHORT_LANGUAGE_NAMES = {
  en: '英', 'zh-CN': '中', ja: '日', ko: '韩', fr: '法', de: '德', es: '西', ru: '俄',
};

function selectedLanguageName() {
  return elements.targetLanguageSelect.selectedOptions[0]?.textContent ?? '';
}

function updateLabels() {
  const short = SHORT_LANGUAGE_NAMES[elements.targetLanguageSelect.value] ?? selectedLanguageName();
  elements.panelTitle.textContent = `输入翻译 · 中 → ${short}`;
  elements.copyButton.textContent = `复制${selectedLanguageName()}`;
}

function resetPanel() {
  translateSequence += 1;
  clearTimeout(debounceTimer);
  elements.sourceInput.value = '';
  elements.resultText.textContent = '等待输入…';
  elements.resultText.classList.add('empty');
  elements.providerText.textContent = '';
  elements.statusText.textContent = '输入后自动翻译';
  elements.copyButton.disabled = true;
  lastTranslation = '';
}

function renderWaiting() {
  translateSequence += 1;
  elements.resultText.textContent = '正在翻译…';
  elements.resultText.classList.add('empty');
  elements.providerText.textContent = '';
  elements.statusText.textContent = '正在翻译…';
  elements.copyButton.disabled = true;
}

async function translateNow() {
  const text = elements.sourceInput.value.trim();
  clearTimeout(debounceTimer);
  if (!text) {
    resetPanel();
    return;
  }
  renderWaiting();
  const sequence = translateSequence;
  try {
    const result = await window.linguaLens.inputPanelTranslate(text);
    if (sequence !== translateSequence) return;
    lastTranslation = result.text;
    elements.resultText.textContent = result.text;
    elements.resultText.classList.remove('empty');
    elements.providerText.textContent = [
      result.provider,
      result.detectedSource ? `检测：${result.detectedSource}` : '',
    ].filter(Boolean).join(' · ');
    elements.statusText.textContent = '翻译完成';
    elements.copyButton.disabled = !result.text;
  } catch (error) {
    if (sequence !== translateSequence) return;
    elements.resultText.textContent = error.message ?? String(error);
    elements.resultText.classList.add('empty');
    elements.statusText.textContent = '翻译失败';
    elements.copyButton.disabled = true;
  }
}

elements.sourceInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  if (!elements.sourceInput.value.trim()) {
    resetPanel();
    return;
  }
  debounceTimer = setTimeout(translateNow, 500);
});

elements.sourceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    translateNow();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) window.linguaLens.hideInputPanel();
});

elements.copyButton.addEventListener('click', () => {
  if (!lastTranslation) return;
  window.linguaLens.copyText(lastTranslation);
  elements.statusText.textContent = '译文已复制';
});

elements.targetLanguageSelect.addEventListener('change', async () => {
  const language = elements.targetLanguageSelect.value;
  const previous = settings?.inputPanelTargetLanguage ?? 'en';
  updateLabels();
  try {
    const current = await window.linguaLens.getSettings();
    const result = await window.linguaLens.saveSettings({
      ...current,
      inputPanelTargetLanguage: language,
    });
    if (!result.ok) {
      elements.targetLanguageSelect.value = previous;
      updateLabels();
      elements.statusText.textContent = result.error ?? '保存失败';
      return;
    }
    settings = result.settings;
    if (elements.sourceInput.value.trim()) translateNow();
  } catch (error) {
    elements.statusText.textContent = error.message ?? String(error);
  }
});

window.linguaLens.getSettings().then((value) => {
  settings = value;
  elements.targetLanguageSelect.value = value.inputPanelTargetLanguage ?? 'en';
  updateLabels();
});

elements.closeButton.addEventListener('click', () => window.linguaLens.hideInputPanel());

window.linguaLens.onInputPanelShown(resetPanel);
elements.sourceInput.focus();
