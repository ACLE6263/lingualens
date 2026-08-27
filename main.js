const fs = require('node:fs');
const path = require('node:path');

const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  screen,
  Tray,
} = require('electron');

const { createFrameSignature } = require('./lib/frame-signature');
const { LiveTranslationSession } = require('./lib/live-translation-session');
const { OcrService } = require('./lib/ocr-service');
const { SettingsStore } = require('./lib/settings-store');
const { translateBlocks, translateText } = require('./lib/translation-service');
const { createTrayIconBuffer } = require('./lib/tray-icon');

const DEFAULT_WINDOW_SIZE = { width: 560, height: 700 };
const MAX_OCR_PIXELS = 8_000_000;
const HIDDEN_STARTUP_FLAG = '--hidden-startup';
const startHidden = process.argv.includes(HIDDEN_STARTUP_FLAG);

let captureWindow = null;
let captureWindowLoadPromise = null;
let captureStarting = false;
let fullScreenTranslationStarting = false;
let resultWindow = null;
let screenTranslationWindow = null;
let translationOverlayWindow = null;
let screenTranslationOverlayWindow = null;
let tray = null;
let settingsStore = null;
let ocrService = null;
let liveTranslationSession = null;
let isQuitting = false;
let activeCaptureHotkey = null;
let activeScreenTranslationHotkey = null;
let liveSkippedFrames = 0;
let currentSelectionSignature = null;
let currentSession = {
  phase: 'ready',
  message: '按快捷键或点击“开始截取”翻译屏幕内容。',
  liveRunning: false,
  liveStatus: 'idle',
  liveSkippedFrames: 0,
  translatedBlocks: [],
};
let currentScreenTranslationSession = {
  phase: 'ready',
  message: '按屏幕翻译快捷键开始翻译当前显示器。',
  liveRunning: false,
  liveStatus: 'idle',
  translatedBlocks: [],
};

function windowOptions(overrides = {}) {
  return {
    show: false,
    frame: false,
    backgroundColor: '#11151f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...overrides,
  };
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
}

function createResultWindow() {
  if (resultWindow && !resultWindow.isDestroyed()) return resultWindow;

  resultWindow = new BrowserWindow(windowOptions({
    ...DEFAULT_WINDOW_SIZE,
    minWidth: 470,
    minHeight: 560,
    title: 'LinguaLens',
    resizable: true,
    maximizable: false,
    skipTaskbar: true,
  }));
  hardenWindow(resultWindow);
  resultWindow.setContentProtection(true);
  resultWindow.loadFile(path.join(__dirname, 'src', 'result.html'));
  resultWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      resultWindow.hide();
    }
  });
  resultWindow.on('closed', () => { resultWindow = null; });
  resultWindow.webContents.on('did-finish-load', () => sendResultState(currentSession));
  return resultWindow;
}

function createScreenTranslationWindow() {
  if (screenTranslationWindow && !screenTranslationWindow.isDestroyed()) return screenTranslationWindow;

  screenTranslationWindow = new BrowserWindow(windowOptions({
    width: 620,
    height: 720,
    minWidth: 470,
    minHeight: 560,
    title: 'LinguaLens - Screen Translation',
    resizable: true,
    maximizable: false,
    skipTaskbar: true,
  }));
  hardenWindow(screenTranslationWindow);
  screenTranslationWindow.setContentProtection(true);
  screenTranslationWindow.loadFile(path.join(__dirname, 'src', 'result.html'), { hash: 'screen' });
  screenTranslationWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      screenTranslationWindow.hide();
    }
  });
  screenTranslationWindow.on('closed', () => { screenTranslationWindow = null; });
  screenTranslationWindow.webContents.on('did-finish-load', () => {
    sendScreenTranslationState(currentScreenTranslationSession);
  });
  return screenTranslationWindow;
}

function ensureCaptureWindow(display) {
  if (!captureWindow || captureWindow.isDestroyed()) {
    const window = new BrowserWindow(windowOptions({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
    }));
    captureWindow = window;
    hardenWindow(window);
    window.setAlwaysOnTop(true, 'screen-saver');
    window.on('closed', () => {
      if (captureWindow === window) {
        captureWindow = null;
        captureWindowLoadPromise = null;
      }
    });
    captureWindowLoadPromise = window.loadFile(path.join(__dirname, 'src', 'capture.html'))
      .then(() => window)
      .catch((error) => {
        if (!window.isDestroyed()) window.destroy();
        throw error;
      });
  } else {
    captureWindow.setBounds({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    }, false);
  }

  return captureWindowLoadPromise ?? Promise.resolve(captureWindow);
}

function hideCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) captureWindow.hide();
}
function placeResultWindow(selectionBounds) {
  const window = createResultWindow();
  if (!selectionBounds) {
    window.center();
    return;
  }

  const display = screen.getDisplayNearestPoint({
    x: Math.round(selectionBounds.x + selectionBounds.width / 2),
    y: Math.round(selectionBounds.y + selectionBounds.height / 2),
  });
  const workArea = display.workArea;
  const rightX = selectionBounds.x + selectionBounds.width + 16;
  const leftX = selectionBounds.x - DEFAULT_WINDOW_SIZE.width - 16;
  const x = rightX + DEFAULT_WINDOW_SIZE.width <= workArea.x + workArea.width
    ? rightX
    : Math.max(workArea.x, leftX);
  const y = Math.min(
    Math.max(workArea.y, selectionBounds.y),
    workArea.y + workArea.height - DEFAULT_WINDOW_SIZE.height,
  );
  window.setBounds({ x: Math.round(x), y: Math.round(y), ...DEFAULT_WINDOW_SIZE });
}

function sendResultState(state) {
  currentSession = { ...currentSession, ...state };
  if (resultWindow && !resultWindow.isDestroyed() && !resultWindow.webContents.isLoading()) {
    resultWindow.webContents.send('result:state', currentSession);
  }
}

function sendScreenTranslationState(state) {
  currentScreenTranslationSession = { ...currentScreenTranslationSession, ...state };
  if (screenTranslationWindow && !screenTranslationWindow.isDestroyed()
    && !screenTranslationWindow.webContents.isLoading()) {
    screenTranslationWindow.webContents.send('screen-translation:state', currentScreenTranslationSession);
  }
}

function showScreenTranslationWindow({ focus = true } = {}) {
  const window = createScreenTranslationWindow();
  if (focus) {
    window.show();
    window.focus();
  } else {
    window.showInactive();
  }
  return window;
}

function closeTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    translationOverlayWindow.destroy();
  }
}

function closeScreenTranslationOverlay() {
  if (screenTranslationOverlayWindow && !screenTranslationOverlayWindow.isDestroyed()) {
    screenTranslationOverlayWindow.destroy();
  }
}

function isWindowVisible(window) {
  return Boolean(window && !window.isDestroyed() && window.isVisible());
}

function getBoundsCenter(bounds) {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}

async function captureDisplay(display) {
  const physicalWidth = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.bounds.height * display.scaleFactor));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physicalWidth, height: physicalHeight },
  });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) ?? sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取屏幕图像。');
  return source.thumbnail;
}

function createCapturePreviewDataUrl(image) {
  const jpeg = image.toJPEG(92);
  if (jpeg.length === 0) throw new Error('无法编码屏幕预览。');
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
function createImageSignature(image) {
  const size = image.getSize();
  return createFrameSignature({ width: size.width, height: size.height, data: image.toBitmap() });
}

function calculateOcrScale(imageSize) {
  const shortestSide = Math.min(imageSize.width, imageSize.height);
  let desiredScale = 1.25;
  if (shortestSide < 160) desiredScale = 2;
  else if (shortestSide < 300) desiredScale = 1.75;
  else if (shortestSide < 520) desiredScale = 1.5;

  const pixelCount = imageSize.width * imageSize.height;
  const pixelLimitedScale = Math.sqrt(MAX_OCR_PIXELS / Math.max(1, pixelCount));
  return Math.max(1, Math.min(desiredScale, pixelLimitedScale));
}

function prepareImageForOcr(image) {
  const imageSize = image.getSize();
  const scale = calculateOcrScale(imageSize);
  if (scale < 1.05) return image.toDataURL();
  return image.resize({
    width: Math.max(1, Math.round(imageSize.width * scale)),
    height: Math.max(1, Math.round(imageSize.height * scale)),
    quality: 'best',
  }).toDataURL();
}

async function captureRegion(bounds) {
  const display = screen.getDisplayNearestPoint(getBoundsCenter(bounds));
  const screenshot = await captureDisplay(display);
  const screenshotSize = screenshot.getSize();
  const scaleX = screenshotSize.width / display.bounds.width;
  const scaleY = screenshotSize.height / display.bounds.height;
  const left = Math.max(0, Math.floor((bounds.x - display.bounds.x) * scaleX));
  const top = Math.max(0, Math.floor((bounds.y - display.bounds.y) * scaleY));
  const right = Math.min(
    screenshotSize.width,
    Math.ceil((bounds.x + bounds.width - display.bounds.x) * scaleX),
  );
  const bottom = Math.min(
    screenshotSize.height,
    Math.ceil((bounds.y + bounds.height - display.bounds.y) * scaleY),
  );
  if (right <= left || bottom <= top) throw new Error('实时翻译区域已超出当前屏幕。');

  const image = screenshot.crop({ x: left, y: top, width: right - left, height: bottom - top });
  return {
    imageDataUrl: prepareImageForOcr(image),
    previewImageDataUrl: image.toDataURL(),
    signature: createImageSignature(image),
  };
}

function stopLiveTranslation() {
  if (liveTranslationSession?.isRunning()) liveTranslationSession.stop();
}

async function startCapture() {
  if (captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible()) {
    captureWindow.focus();
    return;
  }
  if (captureStarting) return;

  captureStarting = true;
  stopLiveTranslation();
  closeTranslationOverlay();
  sendResultState({
    phase: 'capture',
    message: '正在读取屏幕图像…',
    progress: 0.12,
    error: null,
  });

  try {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const [window, screenshotImage] = await Promise.all([
      ensureCaptureWindow(display),
      captureDisplay(display),
    ]);
    const screenshot = createCapturePreviewDataUrl(screenshotImage);
    window.webContents.send('capture:init', {
      screenshot,
      displayBounds: display.bounds,
    });
    sendResultState({
      phase: 'selecting',
      message: '拖动鼠标框选需要翻译的区域。',
      progress: 0.2,
    });
    window.show();
    window.focus();
  } catch (error) {
    hideCaptureWindow();
    sendResultState({
      phase: 'error',
      message: '无法开始截取',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    captureStarting = false;
  }
}
async function translateOcrResult(ocrResult, settings) {
  const sourceText = String(ocrResult.text ?? '').trim();
  if (!sourceText) {
    return { sourceText: '', translatedText: '', translatedBlocks: [], provider: '', detectedSource: '' };
  }

  if (ocrResult.lines.length > 0) {
    const translatedBlocks = await translateBlocks(ocrResult.lines, settings);
    const providers = [...new Set(
      translatedBlocks.map((block) => block.provider).filter((provider) => provider && provider !== 'Original'),
    )];
    return {
      sourceText,
      translatedText: translatedBlocks.map((block) => block.translatedText).join('\n'),
      translatedBlocks,
      provider: providers.join(' + ') || '原文回退',
      detectedSource: translatedBlocks.find((block) => block.detectedSource)?.detectedSource ?? '',
    };
  }

  const translation = await translateText(sourceText, settings);
  return {
    sourceText,
    translatedText: translation.text,
    translatedBlocks: [],
    provider: translation.provider,
    detectedSource: translation.detectedSource,
  };
}

async function recognizeAndTranslate(imageDataUrl, settings, { onProgress, onTranslate } = {}) {
  const ocrResult = await ocrService.recognize(
    imageDataUrl,
    settings.ocrLanguages,
    onProgress,
  );
  if (!ocrResult.text.trim()) {
    return {
      ocrResult,
      sourceText: '',
      translatedText: '',
      translatedBlocks: [],
      provider: '',
      detectedSource: '',
    };
  }
  onTranslate?.(ocrResult);
  return { ocrResult, ...await translateOcrResult(ocrResult, settings) };
}

async function startFullScreenTranslation() {
  if (fullScreenTranslationStarting) {
    showScreenTranslationWindow();
    return;
  }

  fullScreenTranslationStarting = true;
  let displayBounds = null;
  let captureWindowWasVisible = false;
  let captureOverlayWasVisible = false;
  try {
    const screenWindow = createScreenTranslationWindow();
    screenWindow.hide();
    closeScreenTranslationOverlay();

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    displayBounds = { ...display.bounds };
    captureWindowWasVisible = isWindowVisible(captureWindow);
    captureOverlayWasVisible = isWindowVisible(translationOverlayWindow);
    if (captureWindowWasVisible) captureWindow.hide();
    if (captureOverlayWasVisible) translationOverlayWindow.hide();

    sendScreenTranslationState({
      phase: 'capture',
      message: '正在读取屏幕图像…',
      selectionBounds: displayBounds,
      progress: 0.12,
      sourceText: '',
      translatedText: '',
      translatedBlocks: [],
      error: null,
    });

    const screenshot = await captureDisplay(display);
    const imageDataUrl = createCapturePreviewDataUrl(screenshot);
    if (captureWindowWasVisible && !isWindowVisible(captureWindow)) {
      captureWindow.show();
      captureWindow.focus();
    }
    if (captureOverlayWasVisible && !isWindowVisible(translationOverlayWindow)) {
      translationOverlayWindow.showInactive();
    }

    sendScreenTranslationState({
      phase: 'ocr',
      message: '正在识别屏幕文字…',
      imageDataUrl,
      selectionBounds: displayBounds,
      progress: 0.2,
    });
    showScreenTranslationWindow({ focus: !captureWindowWasVisible });
    showFullScreenStatus(displayBounds, '正在识别屏幕文字…');

    const settings = settingsStore.getRuntimeSettings();
    const result = await recognizeAndTranslate(
      prepareImageForOcr(screenshot),
      settings,
      {
        onProgress: (progress) => {
          sendScreenTranslationState({
            phase: 'ocr',
            message: progress.label,
            progress: progress.value,
          });
          showFullScreenStatus(displayBounds, progress.label);
        },
        onTranslate: (ocrResult) => {
          sendScreenTranslationState({
            phase: 'translate',
            message: '正在翻译 ' + (ocrResult.lines.length || 1) + ' 个文本块…',
            sourceText: ocrResult.text.trim(),
            confidence: ocrResult.confidence,
            ocrLineCount: ocrResult.lines.length,
            progress: 1,
          });
          showFullScreenStatus(displayBounds, '正在翻译屏幕文字…');
        },
      },
    );

    sendScreenTranslationState({
      phase: result.sourceText ? 'complete' : 'empty',
      message: result.sourceText ? '全屏翻译完成' : '未识别到屏幕文字',
      progress: 1,
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      translatedBlocks: result.translatedBlocks,
      detectedSource: result.detectedSource,
      provider: result.provider,
      confidence: result.ocrResult.confidence,
      ocrLineCount: result.ocrResult.lines.length,
      error: null,
    });

    if (result.sourceText) {
      showScreenTranslationOverlay(displayBounds, {
        text: result.translatedText,
        blocks: result.translatedBlocks,
        liveRunning: false,
      });
    } else {
      showFullScreenStatus(displayBounds, '未识别到屏幕文字');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendScreenTranslationState({
      phase: 'error',
      message: '全屏翻译失败',
      error: message,
    });
    showScreenTranslationWindow({ focus: !captureWindowWasVisible });
    if (displayBounds) showFullScreenStatus(displayBounds, '全屏翻译失败：' + message);
  } finally {
    if (captureWindowWasVisible && !isWindowVisible(captureWindow)) {
      captureWindow.show();
      captureWindow.focus();
    }
    if (captureOverlayWasVisible && !isWindowVisible(translationOverlayWindow)) {
      translationOverlayWindow.showInactive();
    }
    fullScreenTranslationStarting = false;
  }
}
async function processCapture(payload) {
  if (!payload?.imageDataUrl || !payload?.bounds) throw new Error('截取区域无效。');
  hideCaptureWindow();
  stopLiveTranslation();
  closeTranslationOverlay();

  const capturedImage = nativeImage.createFromDataURL(payload.imageDataUrl);
  if (capturedImage.isEmpty()) throw new Error('截取区域图像无效。');
  currentSelectionSignature = createImageSignature(capturedImage);
  liveSkippedFrames = 0;

  placeResultWindow(payload.bounds);
  resultWindow.show();
  resultWindow.focus();
  sendResultState({
    phase: 'ocr',
    message: '正在识别文字…',
    imageDataUrl: payload.imageDataUrl,
    selectionBounds: payload.bounds,
    progress: 0,
    sourceText: '',
    translatedText: '',
    translatedBlocks: [],
    error: null,
    provider: '',
    detectedSource: '',
    confidence: null,
    ocrLineCount: 0,
    liveRunning: false,
    liveStatus: 'idle',
    liveSkippedFrames: 0,
    liveUpdatedAt: null,
  });

  const settings = settingsStore.getRuntimeSettings();
  try {
    const result = await recognizeAndTranslate(
      prepareImageForOcr(capturedImage),
      settings,
      {
        onProgress: (progress) => sendResultState({
          phase: 'ocr',
          message: progress.label,
          progress: progress.value,
        }),
        onTranslate: (ocrResult) => sendResultState({
          phase: 'translate',
          message: `正在翻译 ${ocrResult.lines.length || 1} 个文本块…`,
          sourceText: ocrResult.text.trim(),
          confidence: ocrResult.confidence,
          ocrLineCount: ocrResult.lines.length,
          progress: 1,
        }),
      },
    );

    if (!result.sourceText) {
      sendResultState({
        phase: 'empty',
        message: '没有识别到文字，请重新框选更清晰的区域。',
        confidence: result.ocrResult.confidence,
        ocrLineCount: result.ocrResult.lines.length,
        progress: 1,
      });
      return;
    }

    sendResultState({
      phase: 'complete',
      message: '翻译完成',
      progress: 1,
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      translatedBlocks: result.translatedBlocks,
      detectedSource: result.detectedSource,
      provider: result.provider,
      confidence: result.ocrResult.confidence,
      ocrLineCount: result.ocrResult.lines.length,
      error: null,
    });
  } catch (error) {
    sendResultState({
      phase: 'error',
      message: '处理失败',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function retryTranslation(sourceText) {
  const text = String(sourceText ?? '').trim();
  if (!text) throw new Error('没有可翻译的文字。');
  stopLiveTranslation();

  sendResultState({
    phase: 'translate',
    message: '正在重新翻译…',
    sourceText: text,
    translatedText: '',
    translatedBlocks: [],
    error: null,
  });
  const translation = await translateText(text, settingsStore.getRuntimeSettings());
  sendResultState({
    phase: 'complete',
    message: '翻译完成',
    sourceText: text,
    translatedText: translation.text,
    translatedBlocks: [],
    detectedSource: translation.detectedSource,
    provider: translation.provider,
  });
  updateTranslationOverlay();
  return translation;
}

function getOverlayPayload() {
  return {
    text: currentSession.translatedText ?? '',
    blocks: Array.isArray(currentSession.translatedBlocks) ? currentSession.translatedBlocks : [],
    liveRunning: Boolean(currentSession.liveRunning),
  };
}

function getScreenTranslationOverlayPayload() {
  return {
    text: currentScreenTranslationSession.translatedText ?? '',
    blocks: Array.isArray(currentScreenTranslationSession.translatedBlocks)
      ? currentScreenTranslationSession.translatedBlocks
      : [],
    liveRunning: false,
  };
}

function updateTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()
    && !translationOverlayWindow.webContents.isLoading()) {
    translationOverlayWindow.webContents.send('overlay:update', getOverlayPayload());
  }
}

function updateScreenTranslationOverlay() {
  if (screenTranslationOverlayWindow && !screenTranslationOverlayWindow.isDestroyed()
    && !screenTranslationOverlayWindow.webContents.isLoading()) {
    screenTranslationOverlayWindow.webContents.send(
      'screen-overlay:update',
      getScreenTranslationOverlayPayload(),
    );
  }
}

function showFullScreenStatus(bounds, message) {
  showScreenTranslationOverlay(bounds, {
    text: '',
    blocks: [],
    liveRunning: false,
    status: message,
  });
}

function showOverlayWindow({
  bounds,
  payload,
  hash = '',
  getWindow,
  setWindow,
  initChannel,
  updateChannel,
}) {
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  if (!bounds || (!payload.text && blocks.length === 0 && !payload.status)) return;

  const overlayBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(8, Math.round(bounds.width)),
    height: Math.max(8, Math.round(bounds.height)),
  };
  const currentWindow = getWindow();
  if (currentWindow && !currentWindow.isDestroyed()) {
    currentWindow.setBounds(overlayBounds);
    if (!currentWindow.webContents.isLoading()) {
      currentWindow.webContents.send(updateChannel, { ...payload, blocks });
    }
    currentWindow.showInactive();
    return currentWindow;
  }

  const overlayWindow = new BrowserWindow(windowOptions({
    ...overlayBounds,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
  }));
  setWindow(overlayWindow);
  hardenWindow(overlayWindow);
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setContentProtection(true);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  const overlayPath = path.join(__dirname, 'src', 'translation-overlay.html');
  if (hash) overlayWindow.loadFile(overlayPath, { hash });
  else overlayWindow.loadFile(overlayPath);
  overlayWindow.on('closed', () => setWindow(null));
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send(initChannel, { ...payload, blocks });
    overlayWindow.showInactive();
  });
  return overlayWindow;
}

function showTranslationOverlay(bounds = currentSession.selectionBounds, payload = getOverlayPayload()) {
  return showOverlayWindow({
    bounds,
    payload,
    getWindow: () => translationOverlayWindow,
    setWindow: (window) => { translationOverlayWindow = window; },
    initChannel: 'overlay:init',
    updateChannel: 'overlay:update',
  });
}

function showScreenTranslationOverlay(
  bounds = currentScreenTranslationSession.selectionBounds,
  payload = getScreenTranslationOverlayPayload(),
) {
  return showOverlayWindow({
    bounds,
    payload,
    hash: 'screen',
    getWindow: () => screenTranslationOverlayWindow,
    setWindow: (window) => { screenTranslationOverlayWindow = window; },
    initChannel: 'screen-overlay:init',
    updateChannel: 'screen-overlay:update',
  });
}

function applyLiveResult(result, frame) {
  currentSelectionSignature = frame.signature;
  if (!result.sourceText) {
    sendResultState({
      phase: 'empty',
      message: '实时更新：当前画面没有识别到文字。',
      imageDataUrl: frame.previewImageDataUrl,
      sourceText: '',
      translatedText: '',
      translatedBlocks: [],
      provider: '',
      detectedSource: '',
      confidence: result.ocrResult.confidence,
      ocrLineCount: result.ocrResult.lines.length,
      progress: 1,
      error: null,
      liveRunning: true,
      liveStatus: 'watching',
      liveUpdatedAt: Date.now(),
    });
  } else {
    sendResultState({
      phase: 'complete',
      message: '实时翻译已更新',
      imageDataUrl: frame.previewImageDataUrl,
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      translatedBlocks: result.translatedBlocks,
      provider: result.provider,
      detectedSource: result.detectedSource,
      confidence: result.ocrResult.confidence,
      ocrLineCount: result.ocrResult.lines.length,
      progress: 1,
      error: null,
      liveRunning: true,
      liveStatus: 'watching',
      liveUpdatedAt: Date.now(),
    });
  }
  updateTranslationOverlay();
}

function handleLiveStatus({ running, status }) {
  if (status === 'unchanged') {
    liveSkippedFrames += 1;
    sendResultState({
      liveRunning: true,
      liveStatus: 'watching',
      liveSkippedFrames,
      message: `实时监听中 · 已跳过 ${liveSkippedFrames} 个未变化画面`,
    });
    return;
  }
  if (status === 'processing') {
    sendResultState({
      liveRunning: true,
      liveStatus: 'processing',
      message: '检测到画面变化，正在更新…',
      error: null,
    });
    return;
  }
  if (status === 'started') {
    sendResultState({
      liveRunning: true,
      liveStatus: 'watching',
      liveSkippedFrames,
      message: '实时翻译已启动，等待画面变化…',
      error: null,
    });
    updateTranslationOverlay();
    return;
  }
  if (status === 'updated') {
    sendResultState({ liveRunning: true, liveStatus: 'watching', liveSkippedFrames });
    return;
  }
  if (!running && status === 'stopped') {
    sendResultState({
      liveRunning: false,
      liveStatus: 'stopped',
      message: '实时翻译已停止',
    });
    updateTranslationOverlay();
  }
}

function handleLiveError(error) {
  sendResultState({
    liveRunning: true,
    liveStatus: 'error',
    message: '实时翻译更新失败，仍会继续监听。',
    error: error instanceof Error ? error.message : String(error),
  });
}

function createLiveTranslationSession() {
  const settings = settingsStore.getRuntimeSettings();
  liveTranslationSession = new LiveTranslationSession({
    captureFrame: captureRegion,
    processFrame: async (frame) => recognizeAndTranslate(
      frame.imageDataUrl,
      settingsStore.getRuntimeSettings(),
      {
        onProgress: (progress) => sendResultState({
          phase: 'ocr',
          liveRunning: true,
          liveStatus: 'processing',
          message: `实时翻译：${progress.label}`,
          progress: progress.value,
        }),
        onTranslate: (ocrResult) => sendResultState({
          phase: 'translate',
          liveRunning: true,
          liveStatus: 'processing',
          message: `实时翻译：正在处理 ${ocrResult.lines.length || 1} 个文本块…`,
          sourceText: ocrResult.text.trim(),
          confidence: ocrResult.confidence,
          ocrLineCount: ocrResult.lines.length,
          progress: 1,
        }),
      },
    ),
    onResult: applyLiveResult,
    onStatus: handleLiveStatus,
    onError: handleLiveError,
    intervalMs: settings.liveIntervalMs,
    changeThreshold: settings.frameChangeThreshold,
  });
}

function toggleLiveTranslation() {
  if (liveTranslationSession.isRunning()) {
    liveTranslationSession.stop();
    return { running: false };
  }
  if (!currentSession.selectionBounds) throw new Error('请先截取一个需要实时翻译的区域。');
  if (!currentSession.sourceText && !currentSession.translatedText) {
    throw new Error('当前区域还没有可用的识别结果。');
  }

  const settings = settingsStore.getRuntimeSettings();
  liveSkippedFrames = 0;
  liveTranslationSession.intervalMs = settings.liveIntervalMs;
  liveTranslationSession.changeThreshold = settings.frameChangeThreshold;
  liveTranslationSession.start(currentSession.selectionBounds, {
    initialSignature: currentSelectionSignature,
  });
  showTranslationOverlay();
  return { running: true };
}

function getStartupExecutablePath() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExecutable && fs.existsSync(portableExecutable)) return portableExecutable;
  return process.execPath;
}

function configureAutoLaunch() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: getStartupExecutablePath(),
      args: [HIDDEN_STARTUP_FLAG],
    });
  } catch {
  }
}
function normalizeHotkey(value) {
  return String(value ?? '').trim();
}

function unregisterActiveHotkeys() {
  for (const accelerator of [activeCaptureHotkey, activeScreenTranslationHotkey]) {
    if (!accelerator) continue;
    try {
      globalShortcut.unregister(accelerator);
    } catch {
    }
  }
  activeCaptureHotkey = null;
  activeScreenTranslationHotkey = null;
}

function registerHotkeys(captureHotkey, screenTranslationHotkey) {
  const captureAccelerator = normalizeHotkey(captureHotkey);
  const screenAccelerator = normalizeHotkey(screenTranslationHotkey);
  if (!captureAccelerator || !screenAccelerator
    || captureAccelerator.toLowerCase() === screenAccelerator.toLowerCase()) return false;

  unregisterActiveHotkeys();
  const registeredAccelerators = [];
  try {
    if (!globalShortcut.register(captureAccelerator, () => {
      startCapture().catch(showFatalError);
    })) throw new Error('capture hotkey registration failed');
    registeredAccelerators.push(captureAccelerator);

    if (!globalShortcut.register(screenAccelerator, () => {
      startFullScreenTranslation().catch(showFatalError);
    })) throw new Error('screen translation hotkey registration failed');
    registeredAccelerators.push(screenAccelerator);

    activeCaptureHotkey = captureAccelerator;
    activeScreenTranslationHotkey = screenAccelerator;
    return true;
  } catch {
    for (const accelerator of registeredAccelerators) {
      try {
        globalShortcut.unregister(accelerator);
      } catch {
      }
    }
    return false;
  }
}

function showFatalError(error) {
  const window = createResultWindow();
  window.show();
  sendResultState({
    phase: 'error',
    message: '操作失败',
    error: error instanceof Error ? error.message : String(error),
  });
}

function refreshTrayMenu() {
  if (!tray) return;
  const settings = settingsStore.getRuntimeSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '屏幕翻译 (' + settings.screenTranslationHotkey + ')',
      click: () => startFullScreenTranslation().catch(showFatalError),
    },
    { label: '截取并翻译 (' + settings.captureHotkey + ')', click: () => startCapture().catch(showFatalError) },
    { label: '打开 LinguaLens', click: () => createResultWindow().show() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconBuffer()).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('LinguaLens 屏幕翻译');
  refreshTrayMenu();
  tray.on('double-click', () => startCapture().catch(showFatalError));
}

function registerIpcHandlers() {
  ipcMain.on('capture:complete', (_event, payload) => processCapture(payload).catch(showFatalError));
  ipcMain.on('capture:cancel', () => {
    hideCaptureWindow();
    sendResultState({
      phase: 'ready',
      message: '已取消截取。按快捷键或点击“开始截取”重试。',
      progress: 0,
      error: null,
    });
  });
  ipcMain.handle('app:full-screen-translate', async () => {
    await startFullScreenTranslation();
    return { ok: true };
  });
  ipcMain.handle('app:start-capture', async () => {
    await startCapture();
    return { ok: true };
  });
  ipcMain.handle('translation:retry', async (_event, sourceText) => retryTranslation(sourceText));
  ipcMain.handle('live:toggle', () => toggleLiveTranslation());
  ipcMain.handle('settings:get', () => settingsStore.getPublicSettings());
  ipcMain.handle('settings:save', (_event, nextSettings) => {
    const previous = settingsStore.getRuntimeSettings();
    const saved = settingsStore.save(nextSettings);
    if (!registerHotkeys(saved.captureHotkey, saved.screenTranslationHotkey)) {
      settingsStore.save(previous);
      registerHotkeys(previous.captureHotkey, previous.screenTranslationHotkey);
      const duplicate = saved.captureHotkey.toLowerCase() === saved.screenTranslationHotkey.toLowerCase();
      const invalidHotkey = duplicate
        ? '两组快捷键不能相同。'
        : '快捷键无法注册，可能已被其他程序占用或格式不正确。';
      return { ok: false, error: invalidHotkey };
    }
    if (liveTranslationSession?.isRunning()) {
      liveTranslationSession.changeThreshold = saved.frameChangeThreshold;
      liveTranslationSession.setIntervalMs(saved.liveIntervalMs);
    }
    refreshTrayMenu();
    return { ok: true, settings: settingsStore.getPublicSettings() };
  });
  ipcMain.on('clipboard:write', (_event, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.on('overlay:show', () => showTranslationOverlay());
  ipcMain.on('overlay:close', () => closeTranslationOverlay());
  ipcMain.on('screen-overlay:close', () => closeScreenTranslationOverlay());
  ipcMain.on('window:set-pinned', (event, pinned) => {
    BrowserWindow.fromWebContents(event.sender)?.setAlwaysOnTop(Boolean(pinned), 'floating');
  });
  ipcMain.on('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = createResultWindow();
    window.show();
    window.focus();
  });

  app.whenReady().then(() => {
    configureAutoLaunch();
    settingsStore = new SettingsStore({
      filePath: path.join(app.getPath('userData'), 'settings.json'),
      safeStorage,
    });
    ocrService = new OcrService({ cachePath: path.join(app.getPath('userData'), 'ocr-cache') });
    createLiveTranslationSession();
    registerIpcHandlers();
    createTray();
    const settings = settingsStore.getRuntimeSettings();
    if (!registerHotkeys(settings.captureHotkey, settings.screenTranslationHotkey)) {
      sendResultState({
        phase: 'error',
        message: '快捷键注册失败',
        error: '截取翻译和屏幕翻译快捷键无法注册，请在设置中修改。',
      });
    }
    const window = createResultWindow();
    const resultReady = new Promise((resolve) => window.once('ready-to-show', resolve));
    const captureReady = ensureCaptureWindow(screen.getPrimaryDisplay()).catch(() => null);
    Promise.all([resultReady, captureReady]).then(() => {
      if (!startHidden) window.show();
    });
  }).catch(showFatalError);
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  liveTranslationSession?.stop();
  ocrService?.terminate();
});