const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  TtsService,
  HOST_SCRIPT,
  FALLBACK_LANGUAGE_TAG,
  buildSpeakCommand,
  encodePowerShellCommand,
  encodeText,
  speechLanguageTag,
  resolvePowerShellPath,
} = require('../lib/tts-service');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// 假宿主进程：不启动真实 powershell，手动喂 EVENT 行来驱动状态机。
function createFakeSpawn() {
  const children = [];
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, options });
    const stdoutHandlers = [];
    const exitHandlers = [];
    const errorHandlers = [];
    const child = {
      pid: 4000 + children.length,
      killed: false,
      stdinClosed: false,
      written: [],
      stdout: {
        setEncoding() {},
        on(event, handler) { if (event === 'data') stdoutHandlers.push(handler); },
      },
      on(event, handler) {
        if (event === 'exit') exitHandlers.push(handler);
        if (event === 'error') errorHandlers.push(handler);
      },
      kill() {
        this.killed = true;
        for (const handler of exitHandlers) handler(0);
      },
      emit(text) { for (const handler of stdoutHandlers) handler(text); },
      emitExit(code) { for (const handler of exitHandlers) handler(code); },
      emitError(error) { for (const handler of errorHandlers) handler(error); },
      stdin: {
        write(chunk) { child.written.push(chunk); return true; },
        end() { child.stdinClosed = true; },
      },
    };
    children.push(child);
    return child;
  };
  return { spawnProcess, children, calls };
}

function createService(extra = {}) {
  const fake = createFakeSpawn();
  const events = [];
  const service = new TtsService({
    spawnProcess: fake.spawnProcess,
    powershellPath: 'powershell.exe',
    onEvent: (event) => events.push(event),
    ...extra,
  });
  return { service, events, ...fake };
}

test('speechLanguageTag maps panel languages to SAPI two-letter tags', () => {
  assert.equal(speechLanguageTag('en'), 'en');
  assert.equal(speechLanguageTag('zh-CN'), 'zh');
  assert.equal(speechLanguageTag('ja'), 'ja');
  assert.equal(speechLanguageTag('ko'), 'ko');
  assert.equal(speechLanguageTag('fr'), 'fr');
  assert.equal(speechLanguageTag('de'), 'de');
  assert.equal(speechLanguageTag('es'), 'es');
  assert.equal(speechLanguageTag('ru'), 'ru');
  assert.equal(speechLanguageTag(' zh-CN '), 'zh', '应忽略首尾空白');
});

test('speechLanguageTag falls back to English for unknown languages', () => {
  for (const value of [undefined, null, '', 'xx', 'klingon', 42, {}]) {
    assert.equal(speechLanguageTag(value), FALLBACK_LANGUAGE_TAG, `${JSON.stringify(value)} 应回退英语`);
  }
});

test('buildSpeakCommand encodes want/fallback/text as three pipe-free fields', () => {
  const command = buildSpeakCommand('Hello world', 'en');
  assert.match(command, /^SPEAK en\|en\|[A-Za-z0-9+/=]+$/);
  const fields = command.slice(6).split('|', 3);
  assert.equal(fields.length, 3);
  assert.equal(fields[0], 'en');
  assert.equal(fields[1], FALLBACK_LANGUAGE_TAG);
  assert.equal(Buffer.from(fields[2], 'base64').toString('utf8'), 'Hello world');
});

test('buildSpeakCommand is injection-safe for hostile translation text', () => {
  const hostile = [
    "It's a | test\nwith $(Get-Process) and \"quotes\"",
    'a|b|c',
    '\r\nEVENT|done\r\nEVENT|fatal|boom',
    "'; Remove-Item C:\\ -Recurse; '",
    '中文 | 日本語 | Русский\n$env:PATH',
  ];
  for (const text of hostile) {
    const fields = buildSpeakCommand(text, 'zh-CN').slice(6).split('|', 3);
    assert.equal(fields.length, 3, `${JSON.stringify(text)} 不应产生额外字段`);
    assert.equal(fields[0], 'zh');
    assert.equal(Buffer.from(fields[2], 'base64').toString('utf8'), text, '文本必须能原样还原');
  }
});

test('encodePowerShellCommand round-trips the host script including CJK', () => {
  assert.equal(Buffer.from(encodePowerShellCommand(HOST_SCRIPT), 'base64').toString('utf16le'), HOST_SCRIPT);
  const cjk = "$s.Speak('今天天气真好')";
  assert.equal(Buffer.from(encodePowerShellCommand(cjk), 'base64').toString('utf16le'), cjk);
});

test('encodeText round-trips UTF-8 text', () => {
  for (const text of ['Hello', '今天天气真好', 'привет мир 2026', '🎧']) {
    assert.equal(Buffer.from(encodeText(text), 'base64').toString('utf8'), text);
  }
});

test('host script uses culture-based matching, stdin loop and default audio device', () => {
  assert.match(HOST_SCRIPT, /TwoLetterISOLanguageName/);
  assert.match(HOST_SCRIPT, /SelectVoice/);
  assert.match(HOST_SCRIPT, /SetOutputToDefaultAudioDevice/);
  assert.match(HOST_SCRIPT, /\[Console\]::In\.ReadLine\(\)/);
  assert.match(HOST_SCRIPT, /EVENT\|ready/);
  assert.match(HOST_SCRIPT, /EVENT\|done/);
});

test('resolvePowerShellPath returns a usable executable reference', () => {
  const resolved = resolvePowerShellPath();
  assert.equal(typeof resolved, 'string');
  assert.ok(resolved.length > 0);
  if (process.platform === 'win32' && resolved.includes('System32')) {
    assert.ok(fs.existsSync(resolved), '绝对路径必须真实存在');
  }
});

test('speak() launches the host with the expected arguments', async () => {
  const { service, calls } = createService();
  service.warmUp();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.ok(calls[0].args.includes('-NoProfile'));
  assert.ok(calls[0].args.includes('-NonInteractive'));
  assert.ok(calls[0].args.includes('-EncodedCommand'));
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[0].options.stdio, ['pipe', 'pipe', 'ignore']);
  service.dispose();
});

test('warmUp() only spawns one host and is idempotent', () => {
  const { service, children } = createService();
  service.warmUp();
  service.warmUp();
  service.warmUp();
  assert.equal(children.length, 1);
  service.dispose();
});

test('speak() resolves with the matched voice once the host reports start', async () => {
  const { service, children, events } = createService();
  const pending = service.speak('Hello world', 'en');
  const child = children[0];

  child.emit('EVENT|ready\n');
  await flush();
  assert.equal(child.written[0].startsWith('SPEAK en|en|'), true, '就绪后才发朗读命令');

  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  const result = await pending;

  assert.deepEqual(result, {
    ok: true,
    voice: 'Microsoft Zira Desktop',
    languageTag: 'en-US',
    matched: true,
  });
  assert.equal(service.isSpeaking, true);
  assert.deepEqual(events.at(-1), {
    type: 'started',
    voice: 'Microsoft Zira Desktop',
    languageTag: 'en-US',
    matched: true,
  });
  service.dispose();
});

test('speak() flags matched=false when the requested language has no voice', async () => {
  const { service, children } = createService();
  const pending = service.speak('こんにちは', 'ja');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  assert.equal(child.written[0].startsWith('SPEAK ja|en|'), true, '应带上英语作为回退');

  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  const result = await pending;
  assert.equal(result.matched, false, '日语请求但拿到英语语音，必须如实标记');
  assert.equal(result.voice, 'Microsoft Zira Desktop');
  service.dispose();
});

test('speak() reports matched=false when the host picks no voice at all', async () => {
  const { service, children } = createService();
  const pending = service.speak('Hello', 'en');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  child.emit('EVENT|started|0|\n');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.matched, false);
  assert.equal(result.voice, '', '空语音名不应被当成匹配');
  service.dispose();
});

test('done event clears the speaking flag and notifies listeners', async () => {
  const { service, children, events } = createService();
  const pending = service.speak('Hello', 'en');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  await pending;
  assert.equal(service.isSpeaking, true);

  child.emit('EVENT|done\n');
  assert.equal(service.isSpeaking, false);
  assert.ok(events.some((event) => event.type === 'done'));
  // 读完不杀宿主：下一次点击仍然即时出声。
  assert.equal(service.host, child);
  service.dispose();
});

test('stop() kills the host immediately and reports stopped', async () => {
  const { service, children, events } = createService();
  const pending = service.speak('A deliberately long sentence', 'en');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  await pending;

  service.stop();
  assert.equal(child.stdinClosed, true);
  assert.equal(service.host, null);
  assert.equal(service.isSpeaking, false);
  assert.ok(events.some((event) => event.type === 'stopped'));
  service.dispose();
});

test('stop() is quiet when nothing is playing', () => {
  const { service, events } = createService();
  service.stop();
  assert.equal(events.length, 0, '空闲时的 stop 不应产生事件');
  service.dispose();
});

test('speak() does not restart a warm idle host (keeps prewarm benefit)', async () => {
  const { service, children } = createService();
  service.warmUp();
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();

  const pending = service.speak('Hello', 'en');
  assert.equal(children.length, 1, '空闲时不应杀掉并重启宿主');
  await flush();
  assert.equal(child.written.length, 1, '应复用同一个宿主的 stdin');
  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(children.length, 1);
  service.dispose();
});

test('speak() interrupts the previous utterance instead of overlapping', async () => {
  const { service, children } = createService();
  const first = service.speak('First sentence', 'en');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  child.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  await first;

  const second = service.speak('Second sentence', 'en');
  assert.equal(child.killed, true, '新朗读必须打断旧朗读');
  assert.equal(children.length, 2, '打断后需要一个新宿主');
  const next = children[1];
  next.emit('EVENT|ready\n');
  await flush();
  next.emit('EVENT|started|en-US|Microsoft Zira Desktop\n');
  assert.equal((await second).ok, true);
  service.dispose();
});

test('speak() rejects empty text without spawning a host', async () => {
  const { service, children } = createService();
  for (const value of ['', '   ', '\n\t', undefined, null]) {
    const result = await service.speak(value, 'en');
    assert.equal(result.ok, false);
  }
  assert.equal(children.length, 0);
  service.dispose();
});

test('speak() surfaces host startup failures instead of throwing', async () => {
  const { service, children } = createService();
  const pending = service.speak('Hello', 'en');
  children[0].emit('EVENT|fatal|System.Speech 不可用\n');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /System\.Speech/);
  service.dispose();
});

test('speak() surfaces an unexpected host exit', async () => {
  const { service, children, events } = createService();
  const pending = service.speak('Hello', 'en');
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();
  child.emitExit(1);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.error, /退出/);
  assert.ok(events.some((event) => event.type === 'error'));
  service.dispose();
});

test('host spawn failure is reported without throwing', async () => {
  const { service, events } = createService({
    spawnProcess: () => { throw new Error('spawn EPERM'); },
  });
  const result = await service.speak('Hello', 'en');
  assert.equal(result.ok, false);
  assert.ok(events.some((event) => event.type === 'error'));
  service.dispose();
});

test('dispose() shuts the host down and refuses further speech', async () => {
  const { service, children } = createService();
  service.warmUp();
  const child = children[0];
  child.emit('EVENT|ready\n');
  await flush();

  service.dispose();
  assert.equal(child.killed, true);
  assert.equal(service.host, null);

  const result = await service.speak('Hello', 'en');
  assert.equal(result.ok, false);
  assert.match(result.error, /已关闭/);
  assert.equal(children.length, 1, 'dispose 后不应再启动宿主');
});

test('partial EVENT lines are reassembled across chunk boundaries', async () => {
  const { service, children } = createService();
  const pending = service.speak('Hello', 'en');
  const child = children[0];
  // 就绪事件被拆成两个 chunk
  child.emit('EVENT|re');
  child.emit('ady\n');
  await flush();
  assert.equal(child.written[0].startsWith('SPEAK en|en|'), true, '就绪后才能发朗读命令');
  // 开始事件也被拆开
  child.emit('EVENT|star');
  child.emit('ted|en-US|Microsoft Zira Desktop\n');
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.voice, 'Microsoft Zira Desktop');
  service.dispose();
});
