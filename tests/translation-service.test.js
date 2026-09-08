const test = require('node:test');
const assert = require('node:assert/strict');

const {
  chunkText,
  detectLanguage,
  parseGoogleClients5Response,
  parseGoogleResponse,
  parseMyMemoryResponse,
  resolveChatCompletionsUrl,
} = require('../lib/translation-service');

test('detectLanguage recognizes common screen text scripts', () => {
  assert.equal(detectLanguage('Hello settings'), 'en');
  assert.equal(detectLanguage('打开设置'), 'zh');
  assert.equal(detectLanguage('設定を開く'), 'ja');
  assert.equal(detectLanguage('설정 열기'), 'ko');
  assert.equal(detectLanguage('Открыть настройки'), 'ru');
});

test('parseGoogleResponse joins translated segments', () => {
  const payload = [[['你好', 'Hello'], ['世界', 'world']], null, 'en'];
  assert.equal(parseGoogleResponse(payload), '你好世界');
});

test('resolveChatCompletionsUrl accepts base and full URLs', () => {
  assert.equal(resolveChatCompletionsUrl('https://api.example.com/v1'), 'https://api.example.com/v1/chat/completions');
  assert.equal(resolveChatCompletionsUrl('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/chat/completions');
});

test('chunkText splits long text without losing content order', () => {
  const input = `${'A'.repeat(40)}\n${'B'.repeat(40)}\n${'C'.repeat(40)}`;
  const chunks = chunkText(input, 60);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join('').replaceAll('\n', ''), input.replaceAll('\n', ''));
});

test('parseMyMemoryResponse validates successful responses', () => {
  assert.equal(parseMyMemoryResponse({ responseStatus: 200, responseData: { translatedText: '你好' } }), '你好');
});


test('parseGoogleClients5Response joins segments and reads detected language', () => {
  const result = parseGoogleClients5Response([['The weather is nice', 'zh-CN']]);
  assert.equal(result.text, 'The weather is nice');
  assert.equal(result.detectedSource, 'zh-CN');
});

test('parseGoogleClients5Response joins multi-segment payloads', () => {
  const result = parseGoogleClients5Response([['Hello ', 'en'], ['world', 'en']]);
  assert.equal(result.text, 'Hello world');
});

test('parseGoogleClients5Response rejects invalid payloads', () => {
  assert.throws(() => parseGoogleClients5Response('nope'));
  assert.throws(() => parseGoogleClients5Response([['', 'en']]));
});
