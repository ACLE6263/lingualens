const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, execSync, spawn } = require('node:child_process');

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

const { computeBlockBackgrounds } = require('./lib/block-background');
const { getForegroundCaptureBounds } = require('./lib/capture-bounds');
const { createFrameSignature } = require('./lib/frame-signature');
const { preprocessBgraBitmap } = require('./lib/image-preprocess');
const { isValidAccelerator } = require('./lib/accelerator');
const { LiveTranslationSession } = require('./lib/live-translation-session');
const { groupLinesIntoParagraphs } = require('./lib/ocr-layout');
const { OcrService } = require('./lib/ocr-service');
const { SettingsStore } = require('./lib/settings-store');
const { TtsService } = require('./lib/tts-service');
const { translateBlocks, translateText } = require('./lib/translation-service');
const { createTrayIconBuffer } = require('./lib/tray-icon');

const DEFAULT_WINDOW_SIZE = { width: 560, height: 700 };
const INPUT_PANEL_SIZE = { width: 640, height: 560 };
const MAX_OCR_PIXELS = 8_000_000;
const HIDDEN_STARTUP_FLAG = '--hidden-startup';
const startHidden = process.argv.includes(HIDDEN_STARTUP_FLAG);

let captureWindow = null;
let captureWindowLoadPromise = null;
let captureStarting = false;
let captureProcessing = false;
let activeCaptureDisplay = null;
let lastCaptureSelection = null;
let fullScreenTranslationStarting = false;
let resultWindow = null;
let translationOverlayWindow = null;
let inputPanelWindow = null;
let tray = null;
let settingsStore = null;
let ocrService = null;
let liveTranslationSession = null;
let ttsService = null;
let isQuitting = false;
const registeredHotkeys = new Map();
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
  applyContentProtection(resultWindow);
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
        activeCaptureDisplay = null;
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
  activeCaptureDisplay = null;
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

function closeTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    translationOverlayWindow.destroy();
  }
  stopOverlayHoverWatcher();
}

// 覆盖层整体鼠标穿透后，工具栏（右上角）仍需可点。Chromium 的
// forward 转发在部分链路上不可靠，这里由主进程轮询光标位置做可靠兜底：
// 光标进入工具栏热区时恢复交互，离开后重新穿透。
const OVERLAY_TOOLBAR_HIT_AREA = { width: 230, height: 40 };
let overlayHoverWatcher = null;
let overlayAcceptsMouse = true;

function setOverlayMouseEvents(window, ignore) {
  if (overlayAcceptsMouse === !ignore) return;
  overlayAcceptsMouse = !ignore;
  try {
    window.setIgnoreMouseEvents(ignore, { forward: true });
  } catch {
  }
}

function startOverlayHoverWatcher() {
  stopOverlayHoverWatcher();
  overlayAcceptsMouse = true;
  overlayHoverWatcher = setInterval(() => {
    const window = translationOverlayWindow;
    if (!window || window.isDestroyed()) {
      stopOverlayHoverWatcher();
      return;
    }
    const bounds = window.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const inToolbar = cursor.x >= bounds.x + bounds.width - OVERLAY_TOOLBAR_HIT_AREA.width
      && cursor.x <= bounds.x + bounds.width
      && cursor.y >= bounds.y
      && cursor.y <= bounds.y + OVERLAY_TOOLBAR_HIT_AREA.height;
    setOverlayMouseEvents(window, !inToolbar);
  }, 100);
}

function stopOverlayHoverWatcher() {
  if (overlayHoverWatcher !== null) {
    clearInterval(overlayHoverWatcher);
    overlayHoverWatcher = null;
  }
}

function getBoundsCenter(bounds) {
  return {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
}


// DWM 扩展边框使用物理像素，不受 PowerShell 进程的 DPI 感知设置影响。
async function getForegroundWindowRect() {
  try {
    const script = [
      "Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); [DllImport(\"dwmapi.dll\")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out R r, int size); public struct R { public int L; public int T; public int Rt; public int B; }' -Name W -Namespace N",
      '$h = [N.W]::GetForegroundWindow()',
      '$owner = [uint32]0',
      '[N.W]::GetWindowThreadProcessId($h, [ref]$owner) | Out-Null',
      `if ($owner -eq ${process.pid}) { exit }`,
      '$r = New-Object N.W+R',
      'if ([N.W]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -eq 0) { "$($r.L),$($r.T),$($r.Rt),$($r.B)" }',
    ].join('; ');
    const output = await new Promise((resolve) => {
      const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
        { encoding: 'utf8', timeout: 2500, windowsHide: true },
        (error, stdout) => resolve(error ? '' : String(stdout ?? '').trim()));
      child.on('error', () => resolve(''));
      child.stdin.on('error', () => resolve(''));
      child.stdin.end(script);
    });
    const parts = output.split(',').map(Number);
    if (parts.length === 4 && parts.every((v) => Number.isFinite(v)) && parts[2] > parts[0] && parts[3] > parts[1]) {
      const [x, y, right, bottom] = parts;
      return { x, y, width: right - x, height: bottom - y };
    }
  } catch {
  }
  return null;
}

// Windows 上 setContentProtection(true) 等价于 SetWindowDisplayAffinity(WDA_MONITOR)，
// 会把窗口标记为"受保护内容"：NVIDIA ShadowPlay（即时回放）等录屏软件检测到
// 之后会停止录制。因此默认不启用系统级保护，改为截图前临时隐藏自身窗口，
// 防止 OCR 读到自己的界面；仅在用户显式开启 captureProtection 设置时才调用。
function applyContentProtection(window) {
  if (!window || window.isDestroyed()) return;
  try {
    window.setContentProtection(Boolean(settingsStore?.getRuntimeSettings()?.captureProtection));
  } catch {
  }
}

function applyAllContentProtection() {
  [resultWindow, inputPanelWindow, translationOverlayWindow].forEach(applyContentProtection);
}

const OWN_WINDOW_HIDE_SETTLE_MS = 80;

function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

// 防截屏保护关闭时的"防套娃"兜底：截图前隐藏与截取目标重叠的自身可见窗口，
// 截完立即恢复。只有重叠的窗口才隐藏（例如实时翻译时放在选区旁的结果窗口
// 不会闪烁）；覆盖层与选区完全重合，实时翻译的每个刷新周期会短暂闪现原文。
async function captureDisplayWithoutOwnWindows(display, targetBounds) {
  if (settingsStore?.getRuntimeSettings()?.captureProtection) {
    return captureDisplay(display);
  }
  const windows = [translationOverlayWindow, resultWindow, inputPanelWindow]
    .filter((window) => window && !window.isDestroyed() && window.isVisible())
    .filter((window) => !targetBounds || rectsIntersect(window.getBounds(), targetBounds));
  for (const window of windows) window.hide();
  try {
    if (windows.length > 0) {
      // 等待 DWM 把隐藏窗口从合成帧中移除，否则截图可能仍带残影。
      await new Promise((resolve) => setTimeout(resolve, OWN_WINDOW_HIDE_SETTLE_MS));
    }
    return await captureDisplay(display);
  } finally {
    for (const window of windows) {
      if (!window.isDestroyed()) window.showInactive();
    }
  }
}

async function captureDisplay(display) {
  const physicalWidth = Math.max(1, Math.round(display.bounds.width * display.scaleFactor));
  const physicalHeight = Math.max(1, Math.round(display.bounds.height * display.scaleFactor));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physicalWidth, height: physicalHeight },
  });
  const byId = sources.find((item) => String(item.display_id) === String(display.id));
  // Windows 上 display_id 与 screen.id 偶尔不一致；静默回退 sources[0] 在多显示器
  // 时会截错屏幕且坐标全错。这里按显示器名二次匹配，单屏可直接使用，
  // 多屏仍无法定位时明确报错而不是截错。
  const byName = sources.find((item) => display.label && item.name === display.label);
  const singleSource = sources.length === 1 ? sources[0] : null;
  const source = byId ?? byName ?? singleSource;
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error(sources.length > 1
      ? `无法定位当前显示器（共 ${sources.length} 块屏幕，ID/名称均未匹配）。`
      : '无法读取屏幕图像。');
  }
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

function preprocessImageForOcr(image) {
  const size = image.getSize();
  const result = preprocessBgraBitmap(image.toBitmap(), size.width, size.height, {
    mode: 'adaptive-gray',
    passthroughOnLuminance: true,
  });
  if (!result) return null;
  const processed = nativeImage.createFromBitmap(result.bitmap, {
    width: size.width,
    height: size.height,
  });
  if (processed.isEmpty()) return null;
  return processed.toPNG();
}

function prepareImageForOcr(image) {
  const imageSize = image.getSize();
  const scale = calculateOcrScale(imageSize);
  const scaled = scale < 1.05 ? image : image.resize({
    width: Math.max(1, Math.round(imageSize.width * scale)),
    height: Math.max(1, Math.round(imageSize.height * scale)),
    quality: 'best',
  });
  try {
    const preprocessed = preprocessImageForOcr(scaled);
    if (preprocessed) return preprocessed;
  } catch {
  }
  return scaled.toPNG();
}

async function captureRegionImage(bounds, display, insideOnly = false) {
  const screenshot = await captureDisplayWithoutOwnWindows(display, bounds);
  const screenshotSize = screenshot.getSize();
  const displayBounds = display.bounds;
  const scaleX = screenshotSize.width / displayBounds.width;
  const scaleY = screenshotSize.height / displayBounds.height;
  const roundStart = insideOnly ? Math.ceil : Math.floor;
  const roundEnd = insideOnly ? Math.floor : Math.ceil;
  const left = Math.max(0, roundStart((bounds.x - displayBounds.x) * scaleX));
  const top = Math.max(0, roundStart((bounds.y - displayBounds.y) * scaleY));
  const right = Math.min(
    screenshotSize.width,
    roundEnd((bounds.x + bounds.width - displayBounds.x) * scaleX),
  );
  const bottom = Math.min(
    screenshotSize.height,
    roundEnd((bounds.y + bounds.height - displayBounds.y) * scaleY),
  );
  if (right <= left || bottom <= top) throw new Error('翻译区域已超出当前屏幕。');

  return screenshot.crop({ x: left, y: top, width: right - left, height: bottom - top });
}

async function captureRegion(bounds) {
  const display = screen.getDisplayNearestPoint(getBoundsCenter(bounds));
  const image = await captureRegionImage(bounds, display);
  return {
    image,
    signature: createImageSignature(image),
  };
}

function stopLiveTranslation() {
  if (liveTranslationSession?.isRunning()) liveTranslationSession.stop();
}

async function startCapture() {
  if (fullScreenTranslationStarting || captureProcessing) return;
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
      captureDisplayWithoutOwnWindows(display, display.bounds),
    ]);
    const screenshot = createCapturePreviewDataUrl(screenshotImage);
    activeCaptureDisplay = display;
    window.webContents.send('capture:init', {
      screenshot,
      displayBounds: display.bounds,
      previousSelection: lastCaptureSelection?.displayId === display.id
        ? lastCaptureSelection.selection
        : null,
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
    // 行合并成段后按段翻译：句子完整、请求数大幅减少、覆盖层不再互相压盖。
    const translatedBlocks = await translateBlocks(groupLinesIntoParagraphs(ocrResult.lines, ocrResult.imageSize), settings);
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

async function recognizeAndTranslate(imageBuffer, settings, { onProgress, onTranslate } = {}) {
  const ocrResult = await ocrService.recognize(
    imageBuffer,
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
  if (fullScreenTranslationStarting || captureStarting || captureProcessing) return;

  fullScreenTranslationStarting = true;
  let captureBounds = null;
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const foregroundRect = await getForegroundWindowRect();
    if (!foregroundRect) throw new Error('无法确定前台窗口，请切换到要翻译的窗口后再试。');
    captureBounds = getForegroundCaptureBounds(
      display.bounds, screen.dipToScreenRect(null, display.bounds), foregroundRect,
    );
    if (!captureBounds) throw new Error('请把鼠标移到前台窗口所在的显示器后再试。');

    hideCaptureWindow();
    stopLiveTranslation();
    closeTranslationOverlay();
    sendResultState({
      phase: 'ocr',
      message: '正在进行全屏翻译…',
      selectionBounds: captureBounds,
      progress: 0,
      sourceText: '',
      translatedText: '',
      translatedBlocks: [],
      liveRunning: false,
      liveStatus: 'idle',
      error: null,
    });

    const screenshot = await captureRegionImage(captureBounds, display, true);
    const settings = settingsStore.getRuntimeSettings();
    showFullScreenStatus(captureBounds, '正在识别屏幕文字…');
    const result = await recognizeAndTranslate(
      prepareImageForOcr(screenshot),
      settings,
      {
        onProgress: (progress) => {
          sendResultState({
            phase: 'ocr',
            message: progress.label,
            progress: progress.value,
          });
          showFullScreenStatus(captureBounds, progress.label);
        },
        onTranslate: (ocrResult) => {
          sendResultState({
            phase: 'translate',
            message: '正在翻译 ' + (ocrResult.lines.length || 1) + ' 个文本块…',
            sourceText: ocrResult.text.trim(),
            confidence: ocrResult.confidence,
            ocrLineCount: ocrResult.lines.length,
            progress: 1,
          });
          showFullScreenStatus(captureBounds, '正在翻译屏幕文字…');
        },
      },
    );
    const imageDataUrl = createCapturePreviewDataUrl(screenshot);
    currentSelectionSignature = createImageSignature(screenshot);
    liveSkippedFrames = 0;

    sendResultState({
      phase: result.sourceText ? 'complete' : 'empty',
      message: result.sourceText ? '全屏翻译完成' : '未识别到屏幕文字',
      imageDataUrl,
      selectionBounds: captureBounds,
      progress: 1,
      sourceText: result.sourceText,
      translatedText: result.translatedText,
      translatedBlocks: result.translatedBlocks,
      detectedSource: result.detectedSource,
      provider: result.provider,
      confidence: result.ocrResult.confidence,
      ocrLineCount: result.ocrResult.lines.length,
      liveRunning: false,
      liveStatus: 'idle',
      error: null,
    });

    if (result.sourceText) {
      const sizedBlocks = computeBlockBackgrounds(
        screenshot.toBitmap(),
        screenshot.getSize().width,
        screenshot.getSize().height,
        result.translatedBlocks,
      );
      showTranslationOverlay(captureBounds, {
        text: result.translatedText,
        blocks: sizedBlocks,
        liveRunning: false,
      });
    } else {
      showFullScreenStatus(captureBounds, '未识别到前台窗口文字');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendResultState({
      phase: 'error',
      message: '全屏翻译失败',
      error: message,
    });
    if (captureBounds) showFullScreenStatus(captureBounds, '全屏翻译失败：' + message);
    else showFatalError(error);
  } finally {
    fullScreenTranslationStarting = false;
  }
}
async function finishCapture(payload, display) {
  if (!payload?.imageDataUrl || !payload?.bounds) throw new Error('截取区域无效。');
  hideCaptureWindow();
  stopLiveTranslation();
  closeTranslationOverlay();

  const capturedImage = nativeImage.createFromDataURL(payload.imageDataUrl);
  if (capturedImage.isEmpty()) throw new Error('截取区域图像无效。');
  lastCaptureSelection = {
    displayId: display.id,
    selection: {
      x: payload.bounds.x - display.bounds.x,
      y: payload.bounds.y - display.bounds.y,
      width: payload.bounds.width,
      height: payload.bounds.height,
    },
  };
  captureProcessing = true;
  try {
    await processCapture(capturedImage, payload.bounds, payload.imageDataUrl);
  } finally {
    captureProcessing = false;
  }
}

async function retranslateLastCapture() {
  if (captureStarting || captureProcessing || fullScreenTranslationStarting) return;
  if (!lastCaptureSelection) throw new Error('请先框选一次需要翻译的区域。');

  const { displayId, selection } = lastCaptureSelection;
  const display = screen.getAllDisplays().find(({ id }) => id === displayId);
  if (!display || selection.x + selection.width > display.bounds.width
    || selection.y + selection.height > display.bounds.height) {
    throw new Error('上次框选的区域已不在可用的显示器范围内，请重新框选。');
  }

  const bounds = {
    ...selection,
    x: display.bounds.x + selection.x,
    y: display.bounds.y + selection.y,
  };
  captureProcessing = true;
  try {
    const captureWasVisible = Boolean(activeCaptureDisplay);
    hideCaptureWindow();
    stopLiveTranslation();
    closeTranslationOverlay();
    if (captureWasVisible) {
      await new Promise((resolve) => setTimeout(resolve, OWN_WINDOW_HIDE_SETTLE_MS));
    }
    const image = await captureRegionImage(bounds, display);
    await processCapture(image, bounds, image.toDataURL());
  } finally {
    captureProcessing = false;
  }
}

async function processCapture(image, bounds, imageDataUrl) {
  currentSelectionSignature = createImageSignature(image);
  liveSkippedFrames = 0;

  placeResultWindow(bounds);
  resultWindow.show();
  resultWindow.focus();
  sendResultState({
    phase: 'ocr',
    message: '正在识别文字…',
    imageDataUrl,
    selectionBounds: bounds,
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
      prepareImageForOcr(image),
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

function updateTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()
    && !translationOverlayWindow.webContents.isLoading()) {
    translationOverlayWindow.webContents.send('overlay:update', getOverlayPayload());
  }
}

function showFullScreenStatus(bounds, message) {
  showTranslationOverlay(bounds, {
    text: '',
    blocks: [],
    liveRunning: false,
    status: message,
  });
}

function ttsStatePayload(event) {
  if (event.type === 'started') {
    return { speaking: true, voice: event.voice ?? '', matched: Boolean(event.matched) };
  }
  if (event.type === 'done') return { speaking: false, reason: 'done' };
  if (event.type === 'stopped') return { speaking: false, reason: 'stopped' };
  return { speaking: false, reason: 'error', message: event.message ?? '朗读失败。' };
}

function broadcastTtsState(event) {
  if (!inputPanelWindow || inputPanelWindow.isDestroyed()) return;
  inputPanelWindow.webContents.send('tts:state', ttsStatePayload(event));
}

// 停止朗读。面板还开着时顺手重新预热，下次点击依然即时出声。
function stopSpeaking({ reWarm = false } = {}) {
  if (!ttsService) return;
  ttsService.stop();
  if (reWarm) ttsService.warmUp();
}

function createInputPanelWindow() {
  if (inputPanelWindow && !inputPanelWindow.isDestroyed()) return inputPanelWindow;

  inputPanelWindow = new BrowserWindow(windowOptions({
    ...INPUT_PANEL_SIZE,
    minWidth: 380,
    minHeight: 250,
    title: 'LinguaLens 输入翻译',
    resizable: true,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
  }));
  hardenWindow(inputPanelWindow);
  inputPanelWindow.setAlwaysOnTop(true, 'floating');
  applyContentProtection(inputPanelWindow);
  inputPanelWindow.loadFile(path.join(__dirname, 'src', 'input-panel.html'));
  inputPanelWindow.on('closed', () => {
    stopSpeaking();
    inputPanelWindow = null;
  });
  return inputPanelWindow;
}

function showInputPanel() {
  const panel = createInputPanelWindow();
  if (panel.isVisible()) {
    stopSpeaking();
    panel.hide();
    return;
  }
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const workArea = display.workArea;
  const x = Math.min(
    Math.max(workArea.x, cursor.x + 12),
    workArea.x + workArea.width - INPUT_PANEL_SIZE.width - 8,
  );
  const y = Math.min(
    Math.max(workArea.y, cursor.y + 12),
    workArea.y + workArea.height - INPUT_PANEL_SIZE.height - 8,
  );
  panel.setBounds({ x: Math.round(x), y: Math.round(y), ...INPUT_PANEL_SIZE });
  if (!panel.webContents.isLoading()) panel.webContents.send('input-panel:shown');
  // 预热系统语音宿主进程：面板打开后再点击「朗读」就不用等冷启动。
  ttsService?.warmUp();
  panel.show();
  panel.focus();
}

function showTranslationOverlay(bounds = currentSession.selectionBounds, payload = getOverlayPayload()) {
  if (!bounds || (!payload.text && payload.blocks.length === 0 && !payload.status)) return;

  const overlayBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(8, Math.round(bounds.width)),
    height: Math.max(8, Math.round(bounds.height)),
  };
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    translationOverlayWindow.setBounds(overlayBounds);
    translationOverlayWindow.webContents.send('overlay:update', payload);
    translationOverlayWindow.showInactive();
    startOverlayHoverWatcher();
    return;
  }

  translationOverlayWindow = new BrowserWindow(windowOptions({
    ...overlayBounds,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
  }));
  hardenWindow(translationOverlayWindow);
  translationOverlayWindow.setAlwaysOnTop(true, 'floating');
  applyContentProtection(translationOverlayWindow);
  translationOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 覆盖层整体鼠标穿透（forward 保留 hover），工具栏悬停时由渲染进程切换回交互。
  translationOverlayWindow.setIgnoreMouseEvents(true, { forward: true });
  translationOverlayWindow.loadFile(path.join(__dirname, 'src', 'translation-overlay.html'));
  translationOverlayWindow.on('closed', () => { translationOverlayWindow = null; });
  translationOverlayWindow.webContents.on('did-finish-load', () => {
    translationOverlayWindow.webContents.send('overlay:init', payload);
    translationOverlayWindow.showInactive();
    startOverlayHoverWatcher();
  });
}

function applyLiveResult(result, frame) {
  currentSelectionSignature = frame.signature;
  const previewImageDataUrl = frame.image.toDataURL();
  // 实时链路同样做无缝背景：用区域截图估计每个文本块的背景色。
  if (result.translatedBlocks?.length) {
    try {
      const size = frame.image.getSize();
      result.translatedBlocks = computeBlockBackgrounds(
        frame.image.toBitmap(),
        size.width,
        size.height,
        result.translatedBlocks,
      );
    } catch {
    }
  }
  if (!result.sourceText) {
    sendResultState({
      phase: 'empty',
      message: '实时更新：当前画面没有识别到文字。',
      imageDataUrl: previewImageDataUrl,
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
      imageDataUrl: previewImageDataUrl,
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
  // 按会话实际状态上报，避免迟到的错误把已停止的 UI 改回"运行中"。
  sendResultState({
    liveRunning: liveTranslationSession?.isRunning() ?? false,
    liveStatus: liveTranslationSession?.isRunning() ? 'error' : 'stopped',
    message: liveTranslationSession?.isRunning() ? '实时翻译更新失败，仍会继续监听。' : '实时翻译已停止',
    error: error instanceof Error ? error.message : String(error),
  });
}

function createLiveTranslationSession() {
  const settings = settingsStore.getRuntimeSettings();
  liveTranslationSession = new LiveTranslationSession({
    captureFrame: captureRegion,
    processFrame: async (frame) => recognizeAndTranslate(
      prepareImageForOcr(frame.image),
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

const AUTOSTART_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = 'LinguaLens';

// 自启目标按运行方式决定，保证"从哪种方式安装/启动，开机就以哪种方式启动"：
// 1. portable 本体（PORTABLE_EXECUTABLE_FILE）→ 注册 portable 路径；
// 2. 解包构建（win-unpacked / 安装版）→ 注册该 exe；
// 3. 源码运行（electron .）→ 注册 electron.exe + 项目路径。
// Temp 解包目录里的内部 exe 不注册（那是 portable 的解包产物，注册它会让
// 开机后跑临时目录里的旧代码）。
function getAutoLaunchTarget() {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;
  if (portableExecutable && fs.existsSync(portableExecutable)) {
    return { path: portableExecutable, args: [HIDDEN_STARTUP_FLAG] };
  }
  if (app.isPackaged) {
    const executableDir = path.dirname(process.execPath);
    if (!executableDir.toLowerCase().startsWith(os.tmpdir().toLowerCase())) {
      return { path: process.execPath, args: [HIDDEN_STARTUP_FLAG] };
    }
    return null;
  }
  const appPath = app.getAppPath();
  if (path.basename(process.execPath).toLowerCase() === 'electron.exe'
    && fs.existsSync(path.join(appPath, 'package.json'))) {
    return { path: process.execPath, args: [appPath, HIDDEN_STARTUP_FLAG] };
  }
  return null;
}

function buildRunCommand(target) {
  const quotedArgs = target.args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
  return `"${target.path}" ${quotedArgs.join(' ')}`;
}

function configureAutoLaunch() {
  if (process.platform !== 'win32') return;
  const target = getAutoLaunchTarget();
  if (!target) return;
  try {
    const command = buildRunCommand(target);
    // reg.exe 的 /d 值内部的引号需要用 \" 转义。
    const escaped = command.replace(/"/g, '\\"');
    execSync(
      `reg add "${AUTOSTART_RUN_KEY}" /v ${AUTOSTART_NAME} /t REG_SZ /d "${escaped}" /f`,
      { stdio: 'ignore' },
    );
    // 收敛自启项：我们始终只写 LinguaLens 一个键名，其余 LinguaLens 相关的
    // 键（旧版 Electron setLoginItemSettings 写下的 electron.app.* 别名键、
    // 或指向 Temp/旧路径的遗留项）一律删除，避免开机双启动。
    const output = execSync(`reg query "${AUTOSTART_RUN_KEY}"`, { encoding: 'utf8' });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)$/);
      if (!match) continue;
      const [, entryName] = match;
      if (entryName === AUTOSTART_NAME) continue;
      if (!/lingualens/i.test(match[1]) && !/lingualens/i.test(match[2])) continue;
      try {
        execSync(`reg delete "${AUTOSTART_RUN_KEY}" /v "${entryName}" /f`, { stdio: 'ignore' });
      } catch {
      }
    }
  } catch {
  }
}
// Electron accelerator 格式校验：至少一个修饰键 + 一个键名，非法值直接
// 拒绝保存，避免 globalShortcut.register 同步抛异常破坏回滚与下次启动。
// 规则实现见 lib/accelerator.js（可单测）。

const hotkeys = [
  { key: 'hotkey', label: '截取翻译', run: startCapture },
  { key: 'fullScreenHotkey', label: '全屏翻译', run: startFullScreenTranslation },
  { key: 'inputHotkey', label: '输入翻译', run: showInputPanel },
  { key: 'retranslateHotkey', label: '重译上次选区', run: retranslateLastCapture },
];

function registerHotkey({ key, run }, accelerator) {
  try {
    if (!globalShortcut.register(accelerator, async () => {
      try {
        await run();
      } catch (error) {
        showFatalError(error);
      }
    })) return false;
  } catch {
    return false;
  }
  registeredHotkeys.set(key, accelerator);
  return true;
}

function unregisterHotkey(key) {
  const accelerator = registeredHotkeys.get(key);
  if (!accelerator) return;
  globalShortcut.unregister(accelerator);
  registeredHotkeys.delete(key);
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

function reportHotkeyFailure(actionName, accelerator) {
  sendResultState({
    phase: 'error',
    message: '快捷键注册失败',
    error: `快捷键 ${accelerator} 已被其他程序占用，${actionName}当前不可用。可在设置中修改。`,
  });
  try {
    tray?.displayBalloon({
      iconType: 'warning',
      title: 'LinguaLens 快捷键注册失败',
      content: `${actionName}的快捷键 ${accelerator} 已被其他程序占用，请到设置中换一个组合。`,
    });
  } catch {
  }
}

function createTray() {
  const icon = nativeImage.createFromBuffer(createTrayIconBuffer()).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('LinguaLens 屏幕翻译');
  updateTrayMenu();
  tray.on('double-click', () => startCapture().catch(showFatalError));
}

function updateTrayMenu() {
  const settings = settingsStore.getRuntimeSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `全屏翻译 (${settings.fullScreenHotkey})`, click: () => startFullScreenTranslation().catch(showFatalError) },
    { label: `截取并翻译 (${settings.hotkey})`, click: () => startCapture().catch(showFatalError) },
    { label: `重译上次选区 (${settings.retranslateHotkey})`, click: () => retranslateLastCapture().catch(showFatalError) },
    { label: `输入翻译（中 → 英） (${settings.inputHotkey})`, click: () => showInputPanel() },
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

function registerIpcHandlers() {
  ipcMain.on('capture:complete', (event, payload) => {
    if (event.sender !== captureWindow?.webContents || !activeCaptureDisplay) return;
    finishCapture(payload, activeCaptureDisplay).catch(showFatalError);
  });
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
  ipcMain.handle('input-panel:translate', async (_event, text, language) => {
    const normalized = String(text ?? '').trim();
    if (!normalized) throw new Error('没有可翻译的内容。');
    const runtime = settingsStore.getRuntimeSettings();
    const settings = { ...runtime, targetLanguage: String(language || runtime.inputPanelTargetLanguage || 'en') };
    return translateText(normalized, settings);
  });
  ipcMain.on('input-panel:hide', () => {
    stopSpeaking();
    if (inputPanelWindow && !inputPanelWindow.isDestroyed()) inputPanelWindow.hide();
  });
  ipcMain.handle('tts:speak', async (_event, payload) => {
    const text = String(payload?.text ?? '').trim();
    if (!text) return { ok: false, error: '没有可朗读的译文。' };
    if (!ttsService) return { ok: false, error: '朗读服务未就绪。' };
    return ttsService.speak(text, payload?.language ?? 'en');
  });
  ipcMain.handle('tts:stop', () => {
    const panelOpen = Boolean(inputPanelWindow && !inputPanelWindow.isDestroyed()
      && inputPanelWindow.isVisible());
    stopSpeaking({ reWarm: panelOpen });
    return { ok: true };
  });
  ipcMain.handle('settings:get', () => settingsStore.getPublicSettings());
  ipcMain.handle('settings:save', (_event, nextSettings) => {
    for (const { key, label } of hotkeys) {
      const value = nextSettings?.[key];
      if (value !== undefined && !isValidAccelerator(value)) {
        return { ok: false, error: `${label}快捷键「${value}」格式无效：需要"修饰键+按键"的组合，例如 Ctrl+Alt+J。` };
      }
    }

    const changedHotkeys = hotkeys
      .filter(({ key }) => nextSettings?.[key] !== undefined)
      .map((hotkey) => ({
        ...hotkey,
        previous: registeredHotkeys.get(hotkey.key),
        accelerator: String(nextSettings[hotkey.key]).trim(),
      }))
      .filter(({ previous, accelerator }) => previous !== accelerator);
    for (const { key } of changedHotkeys) unregisterHotkey(key);
    let saved;
    try {
      for (const hotkey of changedHotkeys) {
        if (!registerHotkey(hotkey, hotkey.accelerator)) {
          return { ok: false, error: `${hotkey.label}快捷键 ${hotkey.accelerator} 无法注册，请换一个组合。` };
        }
      }
      saved = settingsStore.save(nextSettings);
    } finally {
      if (!saved) {
        for (const { key } of changedHotkeys) unregisterHotkey(key);
        for (const hotkey of changedHotkeys) {
          if (hotkey.previous && !registerHotkey(hotkey, hotkey.previous)) {
            reportHotkeyFailure(hotkey.label, hotkey.previous);
          }
        }
      }
    }
    applyAllContentProtection();
    if (changedHotkeys.length) updateTrayMenu();
    if (liveTranslationSession?.isRunning()) {
      liveTranslationSession.changeThreshold = saved.frameChangeThreshold;
      liveTranslationSession.setIntervalMs(saved.liveIntervalMs);
    }
    return { ok: true, settings: settingsStore.getPublicSettings() };
  });
  ipcMain.on('clipboard:write', (_event, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.on('overlay:show', () => showTranslationOverlay());
  ipcMain.on('overlay:close', () => closeTranslationOverlay());
  ipcMain.on('overlay:set-mouse-events', (event, ignore) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) setOverlayMouseEvents(window, Boolean(ignore));
  });
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
    ttsService = new TtsService({ onEvent: (event) => broadcastTtsState(event) });
    createLiveTranslationSession();
    registerIpcHandlers();
    createTray();
    const settings = settingsStore.getRuntimeSettings();
    for (const hotkey of hotkeys) {
      const accelerator = settings[hotkey.key];
      if (!registerHotkey(hotkey, accelerator)) reportHotkeyFailure(hotkey.label, accelerator);
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
  ttsService?.dispose();
  ocrService?.terminate();
});
