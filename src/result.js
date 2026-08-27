const screenMode = window.location.hash === '#screen';

const elements = {
  captureButton: document.querySelector('#captureButton'),
  closeButton: document.querySelector('#closeButton'),
  confidenceText: document.querySelector('#confidenceText'),
  copyButton: document.querySelector('#copyButton'),
  errorText: document.querySelector('#errorText'),
  captureHotkeyInput: document.querySelector('#captureHotkeyInput'),
  screenTranslationHotkeyInput: document.querySelector('#screenTranslationHotkeyInput'),
  liveButton: document.querySelector('#liveButton'),
  liveIntervalInput: document.querySelector('#liveIntervalInput'),
  metaText: document.querySelector('#metaText'),
  minimizeButton: document.querySelector('#minimizeButton'),
  ocrLanguagesInput: document.querySelector('#ocrLanguagesInput'),
  openaiApiKeyInput: document.querySelector('#openaiApiKeyInput'),
  openaiBaseUrlInput: document.querySelector('#openaiBaseUrlInput'),
  openaiFields: document.querySelector('#openaiFields'),
  openaiModelInput: document.querySelector('#openaiModelInput'),
  ollamaBaseUrlInput: document.querySelector('#ollamaBaseUrlInput'),
  ollamaFields: document.querySelector('#ollamaFields'),
  ollamaModelInput: document.querySelector('#ollamaModelInput'),
  overlayButton: document.querySelector('#overlayButton'),
  phaseDot: document.querySelector('#phaseDot'),
  pinButton: document.querySelector('#pinButton'),
  previewCard: document.querySelector('#previewCard'),
  previewImage: document.querySelector('#previewImage'),
  progressBar: document.querySelector('#progressBar'),
  providerText: document.querySelector('#providerText'),
  retryButton: document.querySelector('#retryButton'),
  settingsButton: document.querySelector('#settingsButton'),
  settingsCloseButton: document.querySelector('#settingsCloseButton'),
  settingsError: document.querySelector('#settingsError'),
  settingsForm: document.querySelector('#settingsForm'),
  settingsPanel: document.querySelector('#settingsPanel'),
  sourceText: document.querySelector('#sourceText'),
  statusText: document.querySelector('#statusText'),
  targetLanguageInput: document.querySelector('#targetLanguageInput'),
  toast: document.querySelector('#toast'),
  translatedText: document.querySelector('#translatedText'),
};

let currentState = {};
let pinned = false;
let settings = null;

if (screenMode) {
  document.body.classList.add('screen-mode');
  for (const element of [
    elements.captureButton,
    elements.retryButton,
    elements.overlayButton,
    elements.liveButton,
    elements.settingsButton,
  ]) element.hidden = true;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { elements.toast.hidden = true; }, 1800);
}

function updateMeta(state = currentState) {
  const captureHotkey = settings?.captureHotkey ?? settings?.hotkey ?? 'Alt+Shift+T';
  const screenTranslationHotkey = settings?.screenTranslationHotkey ?? 'Shift+Alt+G';
  if (screenMode) {
    elements.metaText.textContent = screenTranslationHotkey;
  } else if (state.liveRunning) {
    elements.metaText.textContent = `${captureHotkey} · 实时 · 跳过 ${state.liveSkippedFrames ?? 0}`;
  } else {
    elements.metaText.textContent = captureHotkey;
  }
}

function render(state) {
  currentState = state;
  elements.statusText.textContent = state.message ?? '等待截取';
  elements.progressBar.style.width = `${Math.max(0, Math.min(1, state.progress ?? 0)) * 100}%`;
  elements.errorText.hidden = !state.error;
  elements.errorText.textContent = state.error ?? '';
  elements.phaseDot.className = 'phase-dot';
  if (['capture', 'selecting', 'ocr', 'translate'].includes(state.phase) || state.liveStatus === 'processing') {
    elements.phaseDot.classList.add('busy');
  } else if (state.phase === 'error' || state.liveStatus === 'error') {
    elements.phaseDot.classList.add('error');
  } else if (state.phase === 'complete' || state.liveRunning) {
    elements.phaseDot.classList.add('complete');
  }

  if (state.imageDataUrl) {
    elements.previewImage.src = state.imageDataUrl;
    elements.previewCard.hidden = false;
  }
  if (typeof state.sourceText === 'string') elements.sourceText.value = state.sourceText;
  if (state.translatedText) {
    elements.translatedText.textContent = state.translatedText;
    elements.translatedText.classList.remove('empty');
  } else {
    elements.translatedText.textContent = state.phase === 'translate'
      ? '正在生成译文…'
      : state.phase === 'empty' ? '当前画面未识别到文字。' : '等待翻译结果…';
    elements.translatedText.classList.add('empty');
  }

  const confidenceParts = [];
  if (Number.isFinite(state.confidence)) confidenceParts.push(`OCR ${state.confidence}%`);
  if (Number.isFinite(state.ocrLineCount) && state.ocrLineCount > 0) confidenceParts.push(`${state.ocrLineCount} 行`);
  elements.confidenceText.textContent = confidenceParts.join(' · ');
  elements.providerText.textContent = [state.provider, state.liveRunning ? '实时' : ''].filter(Boolean).join(' · ');

  const hasSource = Boolean(elements.sourceText.value.trim());
  const hasTranslation = Boolean(state.translatedText);
  const hasBlocks = Array.isArray(state.translatedBlocks) && state.translatedBlocks.length > 0;
  const translating = state.phase === 'translate' || state.liveStatus === 'processing';
  const captureBusy = ['capture', 'selecting'].includes(state.phase);
  elements.captureButton.disabled = captureBusy;
  elements.captureButton.textContent = state.phase === 'capture'
    ? '正在准备截取…'
    : state.phase === 'selecting' ? '正在框选…' : '⌖ 开始截取';
  elements.retryButton.disabled = !hasSource || translating || state.liveRunning;
  elements.copyButton.disabled = !hasTranslation;
  elements.overlayButton.disabled = (!hasTranslation && !hasBlocks) || !state.selectionBounds;
  elements.liveButton.disabled = !state.selectionBounds || (!hasSource && !state.liveRunning);
  elements.liveButton.textContent = state.liveRunning ? '停止实时翻译' : '开始实时翻译';
  elements.liveButton.classList.toggle('live-active', Boolean(state.liveRunning));
  updateMeta(state);
}

function setProviderFields(provider) {
  elements.openaiFields.classList.toggle('visible', provider === 'openai');
  elements.ollamaFields.classList.toggle('visible', provider === 'ollama');
}

async function openSettings() {
  settings = await window.linguaLens.getSettings();
  elements.captureHotkeyInput.value = settings.captureHotkey ?? settings.hotkey;
  elements.screenTranslationHotkeyInput.value = settings.screenTranslationHotkey;
  elements.targetLanguageInput.value = settings.targetLanguage;
  elements.ocrLanguagesInput.value = settings.ocrLanguages;
  elements.liveIntervalInput.value = String(settings.liveIntervalMs);
  elements.openaiBaseUrlInput.value = settings.openai.baseUrl;
  elements.openaiModelInput.value = settings.openai.model;
  elements.openaiApiKeyInput.value = '';
  elements.openaiApiKeyInput.placeholder = settings.openai.hasApiKey ? '已安全保存；留空保持不变' : 'sk-…';
  elements.ollamaBaseUrlInput.value = settings.ollama.baseUrl;
  elements.ollamaModelInput.value = settings.ollama.model;
  const selectedProvider = document.querySelector(`input[name="provider"][value="${settings.translationProvider}"]`);
  if (selectedProvider) selectedProvider.checked = true;
  setProviderFields(settings.translationProvider);
  elements.settingsError.hidden = true;
  elements.settingsPanel.classList.add('open');
  elements.settingsPanel.setAttribute('aria-hidden', 'false');
  updateMeta();
}

function closeSettings() {
  elements.settingsPanel.classList.remove('open');
  elements.settingsPanel.setAttribute('aria-hidden', 'true');
}

elements.captureButton.addEventListener('click', async () => {
  try {
    await window.linguaLens.startCapture();
  } catch (error) {
    toast(error.message ?? String(error));
  }
});
elements.retryButton.addEventListener('click', async () => {
  try {
    await window.linguaLens.retryTranslation(elements.sourceText.value);
  } catch (error) {
    toast(error.message ?? String(error));
  }
});
elements.copyButton.addEventListener('click', () => {
  window.linguaLens.copyText(currentState.translatedText ?? '');
  toast('译文已复制');
});
elements.overlayButton.addEventListener('click', () => {
  window.linguaLens.showOverlay();
  toast('译文已按文本位置覆盖');
});
elements.liveButton.addEventListener('click', async () => {
  try {
    const result = await window.linguaLens.toggleLiveTranslation();
    toast(result.running ? '实时翻译已启动' : '实时翻译已停止');
  } catch (error) {
    toast(error.message ?? String(error));
  }
});
elements.settingsButton.addEventListener('click', openSettings);
elements.settingsCloseButton.addEventListener('click', closeSettings);
elements.minimizeButton.addEventListener('click', () => window.linguaLens.minimizeWindow());
elements.closeButton.addEventListener('click', () => window.linguaLens.closeWindow());
elements.pinButton.addEventListener('click', () => {
  pinned = !pinned;
  window.linguaLens.setPinned(pinned);
  elements.pinButton.textContent = pinned ? '◆' : '◇';
  toast(pinned ? '窗口已置顶' : '已取消置顶');
});

document.querySelectorAll('input[name="provider"]').forEach((input) => {
  input.addEventListener('change', () => setProviderFields(input.value));
});

elements.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const provider = document.querySelector('input[name="provider"]:checked').value;
  try {
    const result = await window.linguaLens.saveSettings({
      captureHotkey: elements.captureHotkeyInput.value,
      screenTranslationHotkey: elements.screenTranslationHotkeyInput.value,
      targetLanguage: elements.targetLanguageInput.value,
      ocrLanguages: elements.ocrLanguagesInput.value,
      liveIntervalMs: Number(elements.liveIntervalInput.value),
      frameChangeThreshold: settings.frameChangeThreshold,
      translationProvider: provider,
      google: settings.google,
      openai: {
        baseUrl: elements.openaiBaseUrlInput.value,
        model: elements.openaiModelInput.value,
        apiKey: elements.openaiApiKeyInput.value,
      },
      ollama: {
        baseUrl: elements.ollamaBaseUrlInput.value,
        model: elements.ollamaModelInput.value,
      },
    });
    if (!result.ok) {
      elements.settingsError.textContent = result.error;
      elements.settingsError.hidden = false;
      return;
    }
    settings = result.settings;
    closeSettings();
    updateMeta();
    toast('设置已保存');
  } catch (error) {
    elements.settingsError.textContent = error.message ?? String(error);
    elements.settingsError.hidden = false;
  }
});

if (screenMode) window.linguaLens.onScreenTranslationState(render);
else window.linguaLens.onResultState(render);
window.linguaLens.getSettings().then((value) => {
  settings = value;
  updateMeta();
});