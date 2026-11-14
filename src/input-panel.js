const elements = {
  closeButton: document.querySelector('#closeButton'),
  copyButton: document.querySelector('#copyButton'),
  panelTitle: document.querySelector('#panelTitle'),
  providerText: document.querySelector('#providerText'),
  resultText: document.querySelector('#resultText'),
  sourceInput: document.querySelector('#sourceInput'),
  speakButton: document.querySelector('#speakButton'),
  speakLabel: document.querySelector('#speakLabel'),
  statusText: document.querySelector('#statusText'),
  targetLanguageSelect: document.querySelector('#targetLanguageSelect'),
};

let translateSequence = 0;
let debounceTimer = null;
let lastTranslation = '';
let settings = null;
let isSpeaking = false;
let speechStarting = false;
let languageSaveSequence = 0;

const SPEAK_IDLE_LABEL = '朗读文本';
const SPEAK_ACTIVE_LABEL = '停止朗读';

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

function updateSpeakAvailability() {
  elements.speakButton.disabled = !lastTranslation || speechStarting;
}

function renderSpeaking(speaking) {
  isSpeaking = speaking;
  elements.speakButton.classList.toggle('speaking', speaking);
  elements.speakLabel.textContent = speaking ? SPEAK_ACTIVE_LABEL : SPEAK_IDLE_LABEL;
}

// 只在真的在朗读时才发停止指令：空闲时调用会杀掉已预热的语音进程，
// 下次点朗读又得等一次冷启动。
function stopSpeechIfNeeded() {
  if (isSpeaking || speechStarting) window.linguaLens.stopSpeaking();
}

function invalidateTranslation() {
  translateSequence += 1;
  clearTimeout(debounceTimer);
  stopSpeechIfNeeded();
  speechStarting = false;
  renderSpeaking(false);
  lastTranslation = '';
  elements.resultText.classList.add('empty');
  elements.providerText.textContent = '';
  elements.copyButton.disabled = true;
  elements.speakButton.title = '朗读译文';
  updateSpeakAvailability();
}

function resetPanel() {
  invalidateTranslation();
  elements.sourceInput.value = '';
  elements.resultText.textContent = '等待输入…';
  elements.statusText.textContent = '输入后自动翻译';
}

function renderWaiting() {
  invalidateTranslation();
  elements.resultText.textContent = '正在翻译…';
  elements.statusText.textContent = '正在翻译…';
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
    const result = await window.linguaLens.inputPanelTranslate(text, elements.targetLanguageSelect.value);
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
    updateSpeakAvailability();
  } catch (error) {
    if (sequence !== translateSequence) return;
    elements.resultText.textContent = error.message ?? String(error);
    elements.resultText.classList.add('empty');
    elements.statusText.textContent = '翻译失败';
    elements.copyButton.disabled = true;
    updateSpeakAvailability();
  }
}

elements.sourceInput.addEventListener('input', () => {
  if (!elements.sourceInput.value.trim()) {
    resetPanel();
    return;
  }
  renderWaiting();
  debounceTimer = setTimeout(translateNow, 500);
});

elements.sourceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    translateNow();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) hidePanel();
});

elements.copyButton.addEventListener('click', () => {
  if (!lastTranslation) return;
  window.linguaLens.copyText(lastTranslation);
  elements.statusText.textContent = '译文已复制';
});

elements.speakButton.addEventListener('click', async () => {
  if (isSpeaking) {
    await window.linguaLens.stopSpeaking();
    return;
  }
  if (!lastTranslation || speechStarting) return;
  // 朗读启动期间禁止重复点击，避免叠加两条语音。
  speechStarting = true;
  const sequence = translateSequence;
  updateSpeakAvailability();
  try {
    const result = await window.linguaLens.speakTranslation({
      text: lastTranslation,
      language: elements.targetLanguageSelect.value,
    });
    if (sequence !== translateSequence) return;
    if (!result?.ok) {
      elements.statusText.textContent = `朗读失败：${result?.error ?? '未知错误'}`;
      renderSpeaking(false);
      return;
    }
    elements.speakButton.title = `朗读译文（语音：${result.voice}）`;
    elements.statusText.textContent = result.matched
      ? `朗读中 · ${result.voice}`
      : `未安装${selectedLanguageName()}语音，改用 ${result.voice} 朗读`;
  } catch (error) {
    if (sequence !== translateSequence) return;
    elements.statusText.textContent = `朗读失败：${error.message ?? error}`;
    renderSpeaking(false);
  } finally {
    if (sequence === translateSequence) {
      speechStarting = false;
      updateSpeakAvailability();
    }
  }
});

window.linguaLens.onSpeakingState((state) => {
  if (!lastTranslation) return;
  renderSpeaking(Boolean(state?.speaking));
  if (state?.speaking) {
    if (state.voice) elements.speakButton.title = `朗读译文（语音：${state.voice}）`;
    return;
  }
  updateSpeakAvailability();
  if (state?.reason === 'done') elements.statusText.textContent = '朗读完成';
  else if (state?.reason === 'stopped') elements.statusText.textContent = '朗读已停止';
  else if (state?.reason === 'error') elements.statusText.textContent = `朗读失败：${state.message ?? '未知错误'}`;
});

elements.targetLanguageSelect.addEventListener('change', async () => {
  const language = elements.targetLanguageSelect.value;
  const previous = settings?.inputPanelTargetLanguage ?? 'en';
  const sequence = ++languageSaveSequence;
  updateLabels();
  if (elements.sourceInput.value.trim()) renderWaiting();
  try {
    const result = await window.linguaLens.saveSettings({
      inputPanelTargetLanguage: language,
    });
    if (sequence !== languageSaveSequence) return;
    if (!result.ok) throw new Error(result.error ?? '保存失败');
    settings = result.settings;
    if (elements.sourceInput.value.trim()) translateNow();
  } catch (error) {
    if (sequence !== languageSaveSequence) return;
    elements.targetLanguageSelect.value = previous;
    updateLabels();
    if (elements.sourceInput.value.trim()) {
      invalidateTranslation();
      elements.resultText.textContent = '保存目标语言失败。';
    }
    elements.statusText.textContent = error.message ?? String(error);
  }
});

window.linguaLens.getSettings().then((value) => {
  if (languageSaveSequence !== 0) return;
  settings = value;
  elements.targetLanguageSelect.value = value.inputPanelTargetLanguage ?? 'en';
  updateLabels();
});

function hidePanel() {
  resetPanel();
  window.linguaLens.hideInputPanel();
}

elements.closeButton.addEventListener('click', hidePanel);

window.linguaLens.onInputPanelShown(resetPanel);
elements.sourceInput.focus();
