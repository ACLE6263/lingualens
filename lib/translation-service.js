const LANGUAGE_NAMES = {
  'zh-CN': '简体中文', en: '英语', ja: '日语', ko: '韩语',
  fr: '法语', de: '德语', es: '西班牙语', ru: '俄语',
};

const translationCache = new Map();

// Electron 主进程里用 net.fetch（Chromium 网络栈，自动应用系统代理——
// 用户开着系统代理/VPN 时翻译请求和浏览器走同一条路）；纯 Node 环境
// （单元测试）降级为全局 fetch。
let fetchImpl = null;
try {
  const { net } = require('electron');
  if (typeof net?.fetch === 'function') fetchImpl = (...args) => net.fetch(...args);
} catch {
}

function detectLanguage(text) {
  const counts = {
    zh: (text.match(/[\u4e00-\u9fff]/g) ?? []).length,
    ja: (text.match(/[\u3040-\u30ff]/g) ?? []).length,
    ko: (text.match(/[\uac00-\ud7af]/g) ?? []).length,
    ru: (text.match(/[\u0400-\u04ff]/g) ?? []).length,
    en: (text.match(/[A-Za-z]/g) ?? []).length,
  };
  if (counts.ja > 0) return 'ja';
  if (counts.ko > 0) return 'ko';
  if (counts.zh > counts.en * 0.3) return 'zh';
  if (counts.ru > counts.en) return 'ru';
  if (counts.en > 0) return 'en';
  return 'auto';
}

function parseGoogleResponse(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new Error('翻译服务返回了无法识别的数据。');
  }
  return payload[0]
    .filter((segment) => Array.isArray(segment) && typeof segment[0] === 'string')
    .map((segment) => segment[0])
    .join('');
}

function parseMyMemoryResponse(payload) {
  const translated = payload?.responseData?.translatedText;
  if (payload?.responseStatus !== 200 || typeof translated !== 'string' || !translated.trim()) {
    throw new Error(payload?.responseDetails || 'MyMemory 没有返回翻译结果。');
  }
  return translated;
}

function chunkText(text, maxLength = 4200) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    const candidates = [
      remaining.lastIndexOf('\n', maxLength),
      remaining.lastIndexOf('。', maxLength),
      remaining.lastIndexOf('. ', maxLength),
      remaining.lastIndexOf(' ', maxLength),
    ];
    const splitAt = Math.max(...candidates, Math.floor(maxLength * 0.6));
    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  try {
    return await response.json();
  } catch {
    throw new Error('翻译服务返回了无法解析的数据。');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (fetchImpl ?? fetch)(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`翻译服务返回 HTTP ${response.status}: ${body.slice(0, 240)}`);
    }
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('翻译请求超时。');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithMyMemory(text, settings) {
  const source = detectLanguage(text);
  const sourceLanguage = source === 'zh' ? 'zh-CN' : source === 'auto' ? 'en' : source;
  const translated = [];
  for (const textChunk of chunkText(text, 450)) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', textChunk);
    url.searchParams.set('langpair', `${sourceLanguage}|${settings.targetLanguage}`);
    const payload = await fetchJson(url, {}, 12000);
    translated.push(parseMyMemoryResponse(payload));
  }
  return { text: translated.join('\n'), detectedSource: source, provider: 'MyMemory' };
}

async function translateWithGoogle(text, settings) {
  const translated = [];
  let detectedSource = 'auto';
  for (const textChunk of chunkText(text)) {
    const url = new URL(settings.google.endpoint);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', settings.targetLanguage);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', textChunk);
    const payload = await fetchJson(url, { headers: { 'User-Agent': 'LinguaLens/0.1' } }, 7000);
    translated.push(parseGoogleResponse(payload));
    detectedSource = payload[2] ?? detectedSource;
  }
  return { text: translated.join('\n'), detectedSource, provider: 'Google' };
}

// Google 的 Chrome 划词扩展接口（clients5）：与 gtx 端点同源不同配额，
// 作为 gtx 被限流（HTTP 429）或不可达时的备用通道。
const GOOGLE_CLIENTS5_ENDPOINT = 'https://clients5.google.com/translate_a/t';

function parseGoogleClients5Response(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
    throw new Error('翻译服务返回了无法识别的数据。');
  }
  const segments = payload
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
    .filter(Boolean);
  if (segments.length === 0) throw new Error('Google 备用通道没有返回翻译结果。');
  return { text: segments.join(''), detectedSource: payload[0]?.[1] ?? '' };
}

async function translateWithGoogleClients5(text, settings) {
  const translated = [];
  let detectedSource = '';
  for (const textChunk of chunkText(text)) {
    const url = new URL(GOOGLE_CLIENTS5_ENDPOINT);
    url.searchParams.set('client', 'dict-chrome-ex');
    url.searchParams.set('sl', 'auto');
    url.searchParams.set('tl', settings.targetLanguage);
    url.searchParams.set('q', textChunk);
    const payload = await fetchJson(url, { headers: { 'User-Agent': 'LinguaLens/0.1' } }, 7000);
    const parsed = parseGoogleClients5Response(payload);
    translated.push(parsed.text);
    detectedSource = parsed.detectedSource || detectedSource;
  }
  return { text: translated.join('\n'), detectedSource: detectedSource || 'auto', provider: 'Google' };
}

// 超时、服务端 5xx 或限流（429）通常是瞬时故障，自动重试一次能显著
// 降低"服务商临时出问题"导致的翻译失败。
function isTransientError(error) {
  return /超时|HTTP 5\d\d|HTTP 429/.test(String(error?.message ?? ''));
}

async function translateWithRetry(translate) {
  try {
    return await translate();
  } catch (error) {
    if (!isTransientError(error)) throw error;
    return await translate();
  }
}

async function translateWithFreeProvider(text, settings) {
  const attempts = [
    ['MyMemory', () => translateWithMyMemory(text, settings)],
    ['Google', () => translateWithGoogleClients5(text, settings)],
    ['Google-gtx', () => translateWithGoogle(text, settings)],
  ];
  const failures = [];
  for (const [name, translate] of attempts) {
    try {
      return await translateWithRetry(translate);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  throw new Error(`免配置翻译服务不可用（${failures.join('；')}）。可能是翻译服务商临时故障，可稍后重试，或在设置中切换 OpenAI 兼容 / 本地 Ollama 引擎。`);
}

function resolveChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl).replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

async function translateWithOpenAI(text, settings) {
  if (!settings.openai.apiKey) {
    throw new Error('请先在设置中填写 OpenAI 兼容服务的 API Key。');
  }
  const targetName = LANGUAGE_NAMES[settings.targetLanguage] ?? settings.targetLanguage;
  const payload = await fetchJson(resolveChatCompletionsUrl(settings.openai.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.openai.model,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: `You are a screen translation engine. Translate into ${targetName}. Preserve line breaks, UI labels, numbers, and code. Return only the translation.`,
        },
        { role: 'user', content: text },
      ],
    }),
  });
  const translated = payload.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new Error('OpenAI 兼容服务没有返回翻译结果。');
  return { text: translated, detectedSource: detectLanguage(text), provider: 'OpenAI Compatible' };
}

async function translateWithOllama(text, settings) {
  const targetName = LANGUAGE_NAMES[settings.targetLanguage] ?? settings.targetLanguage;
  const url = `${String(settings.ollama.baseUrl).replace(/\/+$/, '')}/api/chat`;
  const payload = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollama.model,
      stream: false,
      options: { temperature: 0.1 },
      messages: [
        {
          role: 'system',
          content: `Translate the user's screen text into ${targetName}. Preserve line breaks and return only the translation.`,
        },
        { role: 'user', content: text },
      ],
    }),
  }, 120000);
  const translated = payload.message?.content?.trim();
  if (!translated) throw new Error('Ollama 没有返回翻译结果。');
  return { text: translated, detectedSource: detectLanguage(text), provider: 'Ollama' };
}

async function translateText(text, settings) {
  const normalized = String(text).trim();
  if (!normalized) throw new Error('没有可翻译的文字。');
  const cacheKey = JSON.stringify([
    settings.translationProvider, settings.targetLanguage,
    settings.openai?.model, settings.ollama?.model, normalized,
  ]);
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  let result;
  if (settings.translationProvider === 'openai') {
    result = await translateWithOpenAI(normalized, settings);
  } else if (settings.translationProvider === 'ollama') {
    result = await translateWithOllama(normalized, settings);
  } else {
    result = await translateWithFreeProvider(normalized, settings);
  }

  translationCache.set(cacheKey, result);
  if (translationCache.size > 100) translationCache.delete(translationCache.keys().next().value);
  return result;
}

async function translateBlocks(blocks, settings, { concurrency = 3 } = {}) {
  const sourceBlocks = Array.isArray(blocks) ? blocks.filter((block) => block?.text?.trim()) : [];
  if (sourceBlocks.length === 0) return [];

  const results = new Array(sourceBlocks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < sourceBlocks.length) {
      const index = nextIndex;
      nextIndex += 1;
      const block = sourceBlocks[index];
      try {
        const translation = await translateText(block.text, settings);
        results[index] = {
          ...block,
          translatedText: translation.text,
          provider: translation.provider,
          detectedSource: translation.detectedSource,
        };
      } catch (error) {
        results[index] = {
          ...block,
          translatedText: block.text,
          provider: 'Original',
          translationError: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), sourceBlocks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  if (results.every((block) => block.translationError)) {
    throw new Error(results[0].translationError);
  }
  return results;
}
module.exports = {
  chunkText,
  detectLanguage,
  parseGoogleClients5Response,
  parseGoogleResponse,
  parseMyMemoryResponse,
  resolveChatCompletionsUrl,
  translateBlocks,
  translateText,
};

