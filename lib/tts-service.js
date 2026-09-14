// Windows 系统语音（SAPI）朗读服务。
//
// 为什么是常驻宿主进程：Electron 从未实现 Web Speech 的 speechSynthesis，
// 只能调用 Windows 原生 SAPI；而 powershell.exe 冷启动实测约 1 秒。如果每次
// 点击都新起一个进程，点「朗读」后会先静默一秒才出声。所以这里让一个已就绪
// 的 PowerShell 宿主进程常驻（面板打开时预热），点击时只往它的 stdin 写一行
// 命令。实测预热后「命令到出声」约 0～150ms。
//
// 为什么用「杀进程」来停止：宿主朗读期间是阻塞的（SAPI 同步 Speak），无法再
// 从 stdin 接收停止指令。终止进程是唯一即时且确定可靠的停止方式，代价是下次
// 朗读需要重新预热。
//
// 防孤儿进程：宿主阻塞在 stdin 上，Electron 退出时管道关闭会让 ReadLine 返回
// null，宿主随即自行退出，不会留下一个还在念稿的野进程。
//
// 语音匹配用 .NET System.Speech 的 Culture 对象（VoiceInfo.Culture），而不是
// COM 的 GetAttribute('Language')——后者返回的是 LCID 的十六进制字符串（英语是
// "409" 即 0x409），按十进制解析会得到错误的语言 ID。Culture 直接给出
// TwoLetterISOLanguageName，语义明确。
//
// 文本全程走 Base64，不拼接进命令或脚本，因此译文里的引号、竖线、换行、
// $(...) 都不可能破坏协议或注入 PowerShell。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// 面板目标语言 -> SAPI 语音的两字母语言代码。面板取值见 input-panel.html。
const SPEECH_LANGUAGE_TAGS = {
  en: 'en',
  'zh-CN': 'zh',
  zh: 'zh',
  ja: 'ja',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  ru: 'ru',
};

// 目标语言没有对应语音时退到英语：拉丁字母文本用英语语音念至少还能听懂，
// 而本机系统默认语音是中文，用它念英文完全不可用。
const FALLBACK_LANGUAGE_TAG = 'en';

const READY_TIMEOUT_MS = 8000;
const START_TIMEOUT_MS = 6000;

// 宿主脚本。用 -EncodedCommand 传入（UTF-16LE + Base64），完全避开命令行编码
// 与引号转义问题。
const HOST_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'try {',
  '  Add-Type -AssemblyName System.Speech',
  '  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '  $synth.SetOutputToDefaultAudioDevice()',
  '} catch {',
  "  [Console]::Out.WriteLine('EVENT|fatal|' + $_.Exception.Message)",
  '  exit 1',
  '}',
  '$synth.Volume = 100',
  '$synth.Rate = 0',
  "[Console]::Out.WriteLine('EVENT|ready')",
  '[Console]::Out.Flush()',
  'while ($true) {',
  '  $line = [Console]::In.ReadLine()',
  '  if ($null -eq $line) { break }',
  "  if ($line -eq 'QUIT') { break }",
  "  if (-not $line.StartsWith('SPEAK ')) { continue }",
  "  $fields = $line.Substring(6).Split('|', 3)",
  '  if ($fields.Length -lt 3) {',
  "    [Console]::Out.WriteLine('EVENT|error|朗读命令格式无效')",
  '    [Console]::Out.Flush()',
  '    continue',
  '  }',
  '  $want = $fields[0]',
  '  $fallback = $fields[1]',
  '  $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($fields[2]))',
  '  try {',
  '    $pick = $null',
  '    foreach ($v in $synth.GetInstalledVoices()) {',
  '      if ($v.Enabled -and $v.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $want) { $pick = $v.VoiceInfo.Name; break }',
  '    }',
  '    if ($null -eq $pick) {',
  '      foreach ($v in $synth.GetInstalledVoices()) {',
  '        if ($v.Enabled -and $v.VoiceInfo.Culture.TwoLetterISOLanguageName -eq $fallback) { $pick = $v.VoiceInfo.Name; break }',
  '      }',
  '    }',
  '    if ($null -ne $pick) { $synth.SelectVoice($pick) }',
  "    [Console]::Out.WriteLine('EVENT|started|' + $synth.Voice.Culture.Name + '|' + $synth.Voice.Name)",
  '[Console]::Out.Flush()',
  '    $synth.Speak($text)',
  "    [Console]::Out.WriteLine('EVENT|done')",
  '[Console]::Out.Flush()',
  '  } catch {',
  "    [Console]::Out.WriteLine('EVENT|error|' + $_.Exception.Message)",
  '[Console]::Out.Flush()',
  '  }',
  '}',
].join('\n');

function encodePowerShellCommand(script) {
  return Buffer.from(String(script), 'utf16le').toString('base64');
}

function encodeText(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function speechLanguageTag(language) {
  const key = String(language ?? '').trim();
  return SPEECH_LANGUAGE_TAGS[key] ?? FALLBACK_LANGUAGE_TAG;
}

function buildSpeakCommand(text, language) {
  const want = speechLanguageTag(language);
  return `SPEAK ${want}|${FALLBACK_LANGUAGE_TAG}|${encodeText(text)}`;
}

function resolvePowerShellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    // 忽略：回退到 PATH 查找
  }
  return 'powershell.exe';
}

class TtsService {
  constructor({ onEvent, spawnProcess, powershellPath } = {}) {
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.spawnProcess = spawnProcess ?? spawn;
    this.powershellPath = powershellPath ?? resolvePowerShellPath();
    this.host = null;
    this.ready = false;
    this.readyWaiters = [];
    this.pendingStart = null;
    this.speaking = false;
    this.outputBuffer = '';
    this.disposed = false;
  }

  // 预热：面板一打开就调用，让点击「朗读」时进程已经就绪。
  warmUp() {
    if (this.disposed || this.host) return;
    this.startHost();
  }

  get isSpeaking() {
    return this.speaking;
  }

  async speak(text, language) {
    const value = String(text ?? '').trim();
    if (!value) return { ok: false, error: '没有可朗读的译文。' };
    if (this.disposed) return { ok: false, error: '朗读服务已关闭。' };

    // 打断上一条，避免两条语音叠在一起。没有在朗读时不要动宿主——否则连续
    // 点击朗读会把已预热的进程杀掉再重启，白白多等一次冷启动。
    if (this.speaking || this.pendingStart) this.stop();

    try {
      await this.ensureReady();
    } catch (error) {
      return { ok: false, error: error.message ?? String(error) };
    }

    const want = speechLanguageTag(language);
    const started = await this.sendSpeakCommand(buildSpeakCommand(value, language));
    if (!started.ok) return started;

    const matched = String(started.languageTag ?? '').toLowerCase().startsWith(want);
    this.speaking = true;
    this.emit({ type: 'started', voice: started.voice, languageTag: started.languageTag, matched });
    return { ok: true, voice: started.voice, languageTag: started.languageTag, matched };
  }

  stop() {
    const wasActive = Boolean(this.speaking || this.pendingStart);
    this.speaking = false;
    this.killHost();
    this.settlePending({ ok: false, error: '朗读已停止。' });
    if (wasActive) this.emit({ type: 'stopped' });
  }

  dispose() {
    this.disposed = true;
    this.speaking = false;
    this.killHost();
    this.settlePending({ ok: false, error: '朗读服务已关闭。' });
  }

  startHost() {
    let child;
    try {
      child = this.spawnProcess(this.powershellPath, [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellCommand(HOST_SCRIPT),
      ], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (error) {
      this.emit({ type: 'error', message: `无法启动系统语音进程：${error.message ?? error}` });
      return;
    }

    this.host = child;
    this.ready = false;
    this.outputBuffer = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (this.host === child) this.consumeOutput(chunk);
    });
    child.on('error', (error) => {
      if (this.host !== child) return;
      this.host = null;
      this.ready = false;
      const message = `系统语音进程出错：${error.message ?? error}`;
      this.failWaiters(message);
      this.settlePending({ ok: false, error: message });
    });
    child.on('exit', () => {
      // stop()/killHost() 会先把 this.host 置空，所以这里只处理非预期退出。
      if (this.host !== child) return;
      this.host = null;
      this.ready = false;
      this.speaking = false;
      const message = '系统语音进程已退出。';
      this.failWaiters(message);
      this.settlePending({ ok: false, error: message });
      this.emit({ type: 'error', message });
    });
  }

  killHost() {
    const child = this.host;
    this.host = null;
    this.ready = false;
    this.outputBuffer = '';
    this.failWaiters('系统语音进程已关闭。');
    if (!child) return;
    try {
      child.stdin.end();
    } catch {
      // 管道可能已关闭
    }
    try {
      child.kill();
    } catch {
      // 进程可能已退出
    }
  }

  ensureReady() {
    if (this.disposed) return Promise.reject(new Error('朗读服务已关闭。'));
    if (this.host && this.ready) return Promise.resolve();
    if (!this.host) this.startHost();
    if (!this.host) return Promise.reject(new Error('无法启动系统语音进程。'));

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((item) => item !== waiter);
        this.killHost();
        reject(new Error('系统语音启动超时。'));
      }, READY_TIMEOUT_MS);
      this.readyWaiters.push(waiter);
    });
  }

  settleReady() {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  failWaiters(message) {
    const waiters = this.readyWaiters;
    this.readyWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(message));
    }
  }

  sendSpeakCommand(command) {
    return new Promise((resolve) => {
      const pending = { resolve, timer: null };
      pending.timer = setTimeout(() => {
        if (this.pendingStart === pending) this.pendingStart = null;
        this.killHost();
        resolve({ ok: false, error: '系统语音没有响应。' });
      }, START_TIMEOUT_MS);
      this.pendingStart = pending;

      try {
        this.host.stdin.write(`${command}\n`);
      } catch (error) {
        if (this.pendingStart === pending) this.pendingStart = null;
        clearTimeout(pending.timer);
        resolve({ ok: false, error: `无法发送朗读指令：${error.message ?? error}` });
      }
    });
  }

  settlePending(result) {
    const pending = this.pendingStart;
    this.pendingStart = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  consumeOutput(chunk) {
    this.outputBuffer += chunk;
    let index = this.outputBuffer.indexOf('\n');
    while (index >= 0) {
      const line = this.outputBuffer.slice(0, index).replace(/\r$/, '');
      this.outputBuffer = this.outputBuffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.outputBuffer.indexOf('\n');
    }
  }

  handleLine(line) {
    if (!line.startsWith('EVENT|')) return;
    const [, name, ...rest] = line.split('|');

    if (name === 'ready') {
      this.ready = true;
      this.settleReady();
      return;
    }
    if (name === 'started') {
      this.settlePending({
        ok: true,
        languageTag: rest[0] ?? '',
        voice: rest.slice(1).join('|'),
      });
      return;
    }
    if (name === 'done') {
      this.speaking = false;
      this.emit({ type: 'done' });
      return;
    }
    if (name === 'fatal') {
      // 宿主已宣告自己起不来（例如 Add-Type 失败），立刻失败，不要干等
      // 就绪超时。
      const message = rest.join('|') || '系统语音朗读失败。';
      this.speaking = false;
      this.failWaiters(message);
      this.settlePending({ ok: false, error: message });
      this.emit({ type: 'error', message });
      return;
    }
    if (name === 'error') {
      const message = rest.join('|') || '系统语音朗读失败。';
      this.speaking = false;
      this.settlePending({ ok: false, error: message });
      this.emit({ type: 'error', message });
    }
  }

  emit(event) {
    try {
      this.onEvent(event);
    } catch {
      // 监听方异常不应影响朗读生命周期
    }
  }
}

module.exports = {
  TtsService,
  HOST_SCRIPT,
  SPEECH_LANGUAGE_TAGS,
  FALLBACK_LANGUAGE_TAG,
  buildSpeakCommand,
  encodePowerShellCommand,
  encodeText,
  speechLanguageTag,
  resolvePowerShellPath,
};
