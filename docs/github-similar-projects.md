# GitHub 屏幕翻译项目调研

调研日期：2026-08-04

目标：寻找与 LinguaLens 类似的截图 OCR、屏幕翻译、原位覆盖和实时翻译项目，并判断哪些设计适合借鉴。

> Stars、最近推送和发布信息来自 GitHub CLI/API 在调研日期的快照，会随时间变化。

## 候选项目

| 项目 | Stars | 最近推送 | 最新发布 | 技术栈 | 许可证 | 重点能力 |
|---|---:|---|---|---|---|---|
| [WinLens](https://github.com/marco-beltrame/WinLens) | 233 | 2026-05-29 | v1.2.0 | C# / WPF / Windows OCR | MIT | 全屏原位替换、多显示器、按文字脚本选择 OCR、逐块覆盖 |
| [STranslate](https://github.com/STranslate/STranslate) | 7,688 | 2026-08-02 | v2.0.9 | C# / WPF | MIT | 即用型翻译与 OCR、成熟的 OCR/翻译插件目录 |
| [eSearch](https://github.com/xushengfeng/eSearch) | 6,880 | 2026-07-31 | 15.3.4 | TypeScript / Electron | GPL-3.0 | 截图、离线 PaddleOCR、翻译、贴图、滚动截屏、录屏、屏幕文字替换 |
| [Translumo](https://github.com/ramjke/Translumo) | 5,592 | 2026-06-14 | v1.0.2 | C# | Apache-2.0 | 游戏实时翻译、多 OCR 结果评分、低延迟覆盖、Windows OCR |
| [LunaTranslator](https://github.com/HIllya51/LunaTranslator) | 12,599 | 2026-08-04 | v10.16.2.5 | C++ | GPL-3.0 | 游戏文本 HOOK、OCR、内嵌翻译、大量翻译/TTS/语言学习接口 |
| [MORT](https://github.com/killkimno/MORT) | 1,658 | 2026-08-02 | 1.316 | C# | MIT | 实时 OCR、多个 OCR 区域、Windows/Tesseract/EasyOCR、多翻译服务 |
| [AI Screenshot Translator](https://github.com/Diraw/AI-Screenshot-Translator) | 203 | 2026-05-16 | v1.0.5 | C++ / Qt 6 / WebView2 | GPL-3.0 | 论文截图、公式/LaTeX、Markdown 富文本、归档和标签 |
| [ScreenTranslator](https://github.com/OneMoreGres/ScreenTranslator) | 1,259 | 2025-09-13 | 3.3.0（2022） | C++ / Qt | MIT | 经典的截图 + Tesseract OCR + 在线翻译组合，可脚本扩展服务 |
| [Pot Desktop](https://github.com/pot-app/pot-desktop) | 19,179 | 2026-07-04 | 3.0.7 | Tauri / JavaScript / Rust | GPL-3.0 | 划词、输入、剪贴板、截图 OCR、插件化识别和翻译服务 |

## 最值得深入看的项目

### 1. WinLens：和 LinguaLens 最接近

WinLens 的目标就是把屏幕文字原位替换成译文。其流程是：捕获整个虚拟屏幕、约 2 倍放大、按 Latin/CJK 脚本运行多个 Windows OCR 识别器、去除重叠块、逐行翻译，然后用匹配背景色和字体的矩形覆盖原文字。

与 LinguaLens 的重合点：

- 全局快捷键和托盘。
- OCR 后仅发送文本到在线翻译端点。
- Google 翻译加 MyMemory 回退。
- 译文覆盖回原屏幕。

LinguaLens 当前的差异优势：

- 已支持区域框选，而 WinLens 的区域截取仍在路线图中。
- 已支持 OpenAI 兼容接口和本地 Ollama。
- 跨平台 Electron 架构更容易移植，但体积和资源占用高于 WPF。

最值得借鉴：Windows OCR 优先、按脚本选择识别器、逐文字块布局与背景色匹配、全虚拟屏幕 DPI 坐标处理。

### 2. STranslate：最佳插件架构参考

STranslate 是活跃的 WPF 翻译/OCR 工具，仓库中已经存在独立的 `src/Plugins` 目录和按插件拆分的 OCR/翻译项目，包括插件清单、设置页面和多语言资源。

最值得借鉴：

- 用 manifest 描述插件元数据和能力。
- OCR 与翻译 Provider 使用统一接口。
- 插件拥有独立配置 UI 和语言资源。
- 主程序只负责发现、排序、调用和错误隔离。

### 3. eSearch：最佳 Electron 与离线 OCR 参考

它和 LinguaLens 一样采用 Electron，但功能远超翻译：离线 PaddleOCR、贴图、屏幕翻译、滚动截屏、录屏、搜索和图像处理。屏幕翻译会创建贴图窗口，并把图片中的文字替换为译文，还可定时翻译视频或游戏画面。

最值得借鉴：

- PaddleOCR/ONNX 作为 Tesseract 之外的高精度后端。
- OCR 结果的段落和标点分段。
- 贴图窗口、滚动截屏与截图后动作流水线。
- Electron 中管理大型本地模型和外部运行库的方法。

### 4. Translumo 与 MORT：最佳实时翻译参考

Translumo 面向游戏低延迟场景，可同时运行多个 OCR 引擎，并通过模型给识别结果评分。MORT 支持多个 OCR 区域、持续翻译以及多种 Windows/云端 OCR。

最值得借鉴：

- 固定区域持续捕获，不需要每次重新框选。
- 图像差异检测：区域内容没变化时跳过 OCR 和翻译。
- 多区域、独立目标语言和独立覆盖层。
- OCR 结果评分、去抖、缓存和延迟监控。

### 5. AI Screenshot Translator：最佳论文/公式模式参考

它把截图直接交给多模态 AI，保留 Markdown、代码高亮和 LaTeX，并提供归档、标签和历史编辑，更适合论文、PDF 和技术资料。

最值得借鉴：增加可选的“视觉模型模式”，不先执行传统 OCR，直接让多模态模型理解图片布局与公式。

## 对 LinguaLens 的建议路线

### P0：明显提升基础体验

1. 增加 Windows OCR 后端，Windows 上优先使用，Tesseract.js 作为回退。
2. OCR 返回文字块坐标，不再只返回纯文本。
3. 将覆盖层改为逐块原位覆盖，匹配背景色、字号和对齐方式。
4. 把 OCR 与翻译引擎改成 manifest 插件接口。
5. 增加全屏翻译模式，同时保留现有区域框选模式。

### P1：实时使用场景

1. 固定区域持续翻译。
2. 多区域管理。
3. 图像差异检测和逐块翻译缓存。
4. 显示 OCR、翻译和整体延迟指标。
5. 可调刷新频率和覆盖透明度。

### P2：高级能力

1. PaddleOCR/ONNX 可选模型。
2. 多模态 AI 公式/论文模式。
3. 翻译历史、标签、Anki 导出。
4. 滚动截屏和贴图。
5. 自动更新与正式代码签名。

## 许可证注意事项

LinguaLens 当前使用 MIT：

- WinLens、STranslate、MORT、ScreenTranslator 的 MIT 代码可以在遵守许可证和保留声明的前提下参考或复用。
- Translumo 使用 Apache-2.0，复用时需要保留许可证、NOTICE（如有）和相关声明。
- Pot、eSearch、LunaTranslator、AI Screenshot Translator 使用 GPL-3.0。可以研究交互和架构思路，但不要直接复制代码到 MIT 项目，除非接受相应 GPL 义务或经过单独许可评估。

这不是法律意见；正式发布前应再次核验目标文件和依赖的具体许可证。
