const fs = require('node:fs');

const { createWorker } = require('tesseract.js');
const { parseTsvLayout } = require('./ocr-layout');

const STATUS_LABELS = {
  'loading tesseract core': '正在加载 OCR 核心…',
  'initializing tesseract': '正在初始化 OCR…',
  'loading language traineddata': '首次使用：正在下载语言模型…',
  'initializing api': '正在准备识别引擎…',
  'recognizing text': '正在识别文字…',
};

function dataUrlToBuffer(dataUrl) {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('截图格式无效。');
  return Buffer.from(match[1], 'base64');
}

function readPngSize(buffer) {
  const pngSignature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('OCR 当前只接受 PNG 截图。');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

class OcrService {
  constructor({ cachePath }) {
    this.cachePath = cachePath;
    this.worker = null;
    this.workerLanguages = null;
    this.progressHandler = null;
    fs.mkdirSync(cachePath, { recursive: true });
  }

  async ensureWorker(languages) {
    if (this.worker && this.workerLanguages === languages) return this.worker;

    await this.terminate();
    this.workerLanguages = languages;
    this.worker = await createWorker(languages, 1, {
      cachePath: this.cachePath,
      logger: (message) => {
        const value = Number.isFinite(message.progress) ? message.progress : 0;
        this.progressHandler?.({
          value,
          label: STATUS_LABELS[message.status] ?? message.status ?? '正在识别文字…',
        });
      },
    });
    await this.worker.setParameters({ preserve_interword_spaces: '1' });
    return this.worker;
  }

  async recognize(dataUrl, languages, onProgress) {
    this.progressHandler = onProgress;
    try {
      const imageBuffer = dataUrlToBuffer(dataUrl);
      const imageSize = readPngSize(imageBuffer);
      const worker = await this.ensureWorker(languages);
      const result = await worker.recognize(imageBuffer, {}, { text: true, tsv: true });
      return {
        text: result.data.text ?? '',
        confidence: Math.round(result.data.confidence ?? 0),
        lines: parseTsvLayout(result.data.tsv, imageSize),
        imageSize,
      };
    } finally {
      this.progressHandler = null;
    }
  }

  async terminate() {
    if (this.worker) await this.worker.terminate();
    this.worker = null;
    this.workerLanguages = null;
  }
}

module.exports = { OcrService, dataUrlToBuffer, readPngSize };
