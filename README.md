# LinguaLens

LinguaLens 是一款面向 Windows 的屏幕 OCR 翻译工具。按下全局快捷键后框选屏幕区域，应用会在本地完成 OCR，再通过可切换的翻译引擎生成译文。

## 核心能力

- 单一路径：快捷键 → 框选 → OCR → 翻译。
- 截图默认只在内存中处理，不写入历史文件。
- 按 OCR 行坐标把译文覆盖回原始屏幕区域。
- 固定区域实时翻译，仅在画面发生明显变化时重新 OCR 和翻译。
- 针对小字号截图自动放大 OCR 输入，并限制最大像素量。
- 支持免配置翻译、OpenAI 兼容接口和本地 Ollama。
- API Key 使用 Windows `safeStorage` 加密保存。
- 支持多显示器坐标和高 DPI 截图。

## 运行

```powershell
npm install
npm start
```

默认快捷键：截取翻译 `Alt+Shift+T`，屏幕翻译 `Shift+Alt+G`。两组快捷键都可以在“设置”中自定义，且不能使用相同组合。


第一次 OCR 会下载所选语言模型，之后从本地缓存读取。默认语言包包含简体中文、英语、日语和韩语。

## 使用实时翻译

1. 点击“开始截取”并框选一个固定区域。
2. 等待首次 OCR 和翻译完成。
3. 点击“开始实时翻译”，LinguaLens 会打开原位覆盖层。
4. 画面未变化时会跳过 OCR；刷新间隔可在设置中调整。
5. 点击“停止实时翻译”结束监听，覆盖层可单独关闭。

## 翻译引擎

### 免配置翻译

默认选项，不需要 API Key。优先使用当前网络可访问的 MyMemory，并在失败时回退到 Google。稳定生产环境建议配置正式服务或本地 Ollama。

### OpenAI 兼容接口

支持标准 `/chat/completions` 接口。填写 Base URL、模型和 API Key。API Key 通过 Electron `safeStorage` 调用 Windows 数据保护能力加密后保存。

### Ollama

默认连接 `http://127.0.0.1:11434`，默认模型为 `qwen2.5:3b`。需要先在本机安装并启动 Ollama、下载对应模型。

## 验证与打包

```powershell
npm run check
npm test
npx electron scripts/smoke-ocr.js
npm run dist
```

打包结果位于 `dist` 目录。

## 隐私边界

- OCR 在本地 Tesseract.js worker 中执行。
- 原始截图不写入磁盘。
- 使用在线翻译引擎时，只有 OCR 后的文本会发送给所选服务。
- OCR 语言模型会缓存在 Electron 用户数据目录中。
- 主窗口和翻译覆盖层启用屏幕捕获保护，避免实时截图重复识别自身界面。

## 已知限制

- Tesseract 首次加载多语言模型需要一定时间。
- 一次框选仅限鼠标所在显示器，不支持跨显示器区域。
- 坐标来自 Tesseract 行级 TSV，复杂排版和旋转文本的覆盖效果仍可能不理想。
- Google 即时翻译端点不是带 SLA 的商业 API。

GitHub 同类项目调研见 `docs/github-similar-projects.md`。

## 全屏翻译
按屏幕翻译快捷键可截取鼠标所在显示器的整个屏幕。翻译进度和文本结果会在独立的屏幕翻译窗口中显示，同时将目标语言译文按 OCR 文本位置覆盖回原屏幕；不会清空或改写截取翻译窗口的结果。再次按下快捷键会重新翻译当前显示器。

应用支持托盘驻留和 Windows 开机自启动；开机启动时默认不显示主窗口。
