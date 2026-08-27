# Windows 屏幕 OCR 翻译与覆盖翻译开源项目调研

调研截止日期：**2026-08-04**

## 范围与方法

- 仅使用项目自己的 GitHub 仓库、README、构建清单、许可证、提交页和 Release 页。
- “最近提交”指默认分支 HEAD；“最近发布”指最新可见的 GitHub Release。
- 技术栈依据仓库语言、`package.json`、`Cargo.toml`、`.csproj`、`.pro`、CMake 文件及 README。
- 本文只做调研，不修改 LinguaLens 代码。

## 核心结论

最值得 LinguaLens 直接研究的三个项目：

1. **WinLens**：最接近“按 OCR 文字块原位覆盖译文”的目标，尤其值得借鉴块级布局、背景/字体匹配、多显示器和混合文字脚本处理。
2. **Translumo**：最适合研究低延迟实时循环、区域捕获和多 OCR 结果融合。
3. **eSearch**：最适合研究“框选、离线 OCR、贴图、文字替换、定时翻译”的完整交互链路。

其他项目中，**MORT** 的多 OCR 区域和图像预处理适合游戏；**Pot** 的服务插件接口和多引擎并行适合扩展性；**LunaTranslator** 的多文本输入源和应用配置档案适合长期演进；**ScreenTranslator** 是经典模块化基线，但维护状态较弱。

## 项目总览

| 项目 | 核心定位 | 技术栈 | 许可证 | 最近提交 | 最近 Release | 活跃度判断 |
| --- | --- | --- | --- | --- | --- | --- |
| [pot-app/pot-desktop](https://github.com/pot-app/pot-desktop) | 跨平台划词、截图 OCR 与翻译平台 | Tauri 1.x、Rust、React/Vite、JavaScript/TypeScript | [GPL-3.0](https://github.com/pot-app/pot-desktop/blob/master/LICENSE) | [2026-07-04](https://github.com/pot-app/pot-desktop/commit/594d32ede96acd106b0256deaa8bb440ffcdff40) | [3.0.7，2025-05-10](https://github.com/pot-app/pot-desktop/releases/tag/3.0.7) | 近期仍有提交，但 HEAD 是本地化更新；发布节奏偏慢 |
| [ramjke/Translumo](https://github.com/ramjke/Translumo) | 面向游戏/视频的低延迟实时屏幕翻译 | C#、.NET 8、WPF、SharpDX/D3D11、OpenCV/Python.NET | [Apache-2.0](https://github.com/ramjke/Translumo/blob/master/LICENSE) | [2026-06-14](https://github.com/ramjke/Translumo/commit/df1795ced269c1244a6cf929a11ba28a27284a8d) | [v1.0.2，2025-09-15](https://github.com/ramjke/Translumo/releases/tag/v.1.0.2) | 有近期仓库活动，但 HEAD 仅为 README 修正；功能活跃信号中等 |
| [OneMoreGres/ScreenTranslator](https://github.com/OneMoreGres/ScreenTranslator) | 经典截图、OCR、在线翻译托盘工具 | C++17、Qt 5、Tesseract、Leptonica | [MIT](https://github.com/OneMoreGres/ScreenTranslator/blob/master/LICENSE.md) | [2025-09-13](https://github.com/OneMoreGres/ScreenTranslator/commit/d4931bf797f4e7a665dd00ae7b00812634e662b0) | [3.3.0，2022-07-30](https://github.com/OneMoreGres/ScreenTranslator/releases/tag/3.3.0) | README 明确称项目几乎废弃，应视为低维护参考实现 |
| [killkimno/MORT](https://github.com/killkimno/MORT) | Windows 游戏实时 OCR 翻译、多区域监控 | C#、.NET 9、WPF、SharpDX/D3D11、WebView2、内嵌 Python | [MIT](https://github.com/killkimno/MORT/blob/main/LICENSE) | [2026-08-02](https://github.com/killkimno/MORT/commit/63409fa08a4b4589438664ecf803884f289b99e0) | [1.316，2026-08-02](https://github.com/killkimno/MORT/releases/tag/1.316) | 截止日前两天仍提交和发布，活跃度高 |
| [HIllya51/LunaTranslator](https://github.com/HIllya51/LunaTranslator) | 视觉小说翻译平台，支持 HOOK、OCR 和内嵌翻译 | Python、PyQt 5/6、C/C++ 原生模块、CMake | [GPL-3.0](https://github.com/HIllya51/LunaTranslator/blob/main/LICENSE) | [2026-08-04](https://github.com/HIllya51/LunaTranslator/commit/edd88c4c2343f325e88528834d78e4fbf0e1fec1) | [v10.16.2.5，2026-08-04](https://github.com/HIllya51/LunaTranslator/releases/tag/v10.16.2.5) | 截止日当天提交并发布，活跃度很高 |
| [xushengfeng/eSearch](https://github.com/xushengfeng/eSearch) | 截屏、离线 OCR、贴图、翻译和屏幕翻译一体化工具 | Electron、TypeScript、electron-vite、ONNX Runtime、PaddleOCR 系 OCR | [GPL-3.0](https://github.com/xushengfeng/eSearch/blob/master/LICENSE) | [2026-07-31](https://github.com/xushengfeng/eSearch/commit/fe27e7f1b1307defe6e8df8eb0bfa57c41b5353e) | [15.3.4，2026-07-30](https://github.com/xushengfeng/eSearch/releases/tag/15.3.4) | 截止日前一周内有修复和发布，活跃度高 |
| [marco-beltrame/WinLens](https://github.com/marco-beltrame/WinLens) | Windows 全屏 OCR 后按文字块原位覆盖翻译 | C#、.NET 10、WPF、Windows OCR | [MIT](https://github.com/marco-beltrame/WinLens/blob/main/LICENSE) | [2026-05-29](https://github.com/marco-beltrame/WinLens/commit/67e5d875957f0acc86b96693cd3da2883de28ad8) | [v1.2.0，2026-05-25](https://github.com/marco-beltrame/WinLens/releases/tag/v1.2.0) | 截止日前约两个月仍有发布和构建修复，属近期活跃项目 |

## 1. Pot Desktop

**第一手来源：**[README](https://github.com/pot-app/pot-desktop)、[前端清单](https://github.com/pot-app/pot-desktop/blob/master/package.json)、[Tauri/Rust 清单](https://github.com/pot-app/pot-desktop/blob/master/src-tauri/Cargo.toml)。

核心功能包括划词翻译、输入翻译、剪贴板监听、截图 OCR、截图翻译、多接口并行、外部调用和插件系统。Windows 可使用 `Windows.Media.OCR`，同时包含 Tesseract.js，并可通过插件接入 RapidOCR/PaddleOCR。

**LinguaLens 可借鉴：**

- 将 OCR、翻译和后处理统一为稳定的提供方接口。
- 建立可安装的 OCR/翻译适配器，而不是把服务判断继续堆入单个模块。
- 支持多引擎并行比较和外部调用协议。
- Windows 原生 OCR 优先、跨平台 OCR 回退的分层策略。

**限制：**它偏翻译平台和结果面板，不是通用逐文字块覆盖方案。GPL 代码不应直接复制进当前标为 MIT 的 LinguaLens，除非接受相应许可义务。

## 2. Translumo

**第一手来源：**[README](https://github.com/ramjke/Translumo)、[WPF 项目清单](https://github.com/ramjke/Translumo/blob/master/src/Translumo/Translumo.csproj)。

它面向游戏、视频硬字幕和任意屏幕区域的实时翻译。可以同时运行多个 OCR 引擎，并用模型对结果评分择优；支持 Windows OCR、Tesseract、EasyOCR，以及 DeepL、Google、Yandex、Papago。用户先框选较小区域，再启动低延迟持续翻译。

**LinguaLens 可借鉴：**

- 对多 OCR 候选按置信度、文字脚本、合法字符和空间重叠评分。
- 实时模式只监控固定小区域；先检测图像变化，无变化时跳过 OCR。
- 把捕获、预处理、OCR、融合、翻译、覆盖拆成可独立计时和降级的流水线。
- 明确提示游戏使用窗口化或无边框模式。

**限制：**EasyOCR 会带来 Python、模型和可能的 CUDA 负担，适合作为可选组件。最新提交只是 README 修正，不能仅凭提交日期判断核心功能仍高速迭代。

## 3. ScreenTranslator

**第一手来源：**[README](https://github.com/OneMoreGres/ScreenTranslator)、[Qt 项目清单](https://github.com/OneMoreGres/ScreenTranslator/blob/master/screen-translator.pro)。

这是无主窗口、托盘常驻的经典工具：快捷键框选区域，OCR 后调用在线翻译。识别语言包和翻译脚本可单独下载，支持用户目录与便携目录资源。

**LinguaLens 可借鉴：**

- 模型、语言包和翻译脚本按需下载，并显示版本、校验和更新状态。
- 同时支持用户目录和便携目录资源。
- 设置页主动标出失效资源和错误配置。

**限制：**README 明确称项目“几乎废弃”，最新 Release 仍为 2022 年；适合研究模块边界，不适合作为未来依赖基础。

## 4. MORT

**第一手来源：**[README](https://github.com/killkimno/MORT)、[WPF 项目清单](https://github.com/killkimno/MORT/blob/main/MORT/MORT.csproj)、[最近覆盖窗口提交](https://github.com/killkimno/MORT/commit/63409fa08a4b4589438664ecf803884f289b99e0)。

MORT 对游戏对白区域持续截图和 OCR，支持多个 OCR 区域、图像调整、剪贴板/钩子联动，以及 Tesseract、Windows OCR、Google Cloud Vision、Snipping Tool OCR、EasyOCR。它也定义了简单的自定义 HTTP 翻译 API。

**LinguaLens 可借鉴：**

- 多个持久 OCR 区域，每个区域可有独立语言、预处理、刷新频率和覆盖样式。
- 保存应用/游戏配置档案，恢复窗口匹配和区域位置。
- 提供简单稳定的自定义 HTTP 翻译协议。
- 增加亮度、对比度、缩放、灰度、阈值化等逐区域预处理。

**限制：**README 明确不支持独占全屏游戏，需窗口化或无边框窗口。高级选项很多，LinguaLens 默认体验仍应保持自动化。

## 5. LunaTranslator

**第一手来源：**[README](https://github.com/HIllya51/LunaTranslator)、[PyQt 兼容层](https://github.com/HIllya51/LunaTranslator/blob/main/src/LunaTranslator/qtsymbols.py)、[原生模块](https://github.com/HIllya51/LunaTranslator/tree/main/src/NativeImpl)。

它可通过文本 HOOK、模拟器 HOOK、OCR、剪贴板等通道获取文字；部分游戏支持把翻译内嵌回游戏。还支持大量在线/离线 OCR、传统翻译、LLM、TTS、日语分词和 AnkiConnect。

**LinguaLens 可借鉴：**

- 把“文本获取”抽象为输入源：OCR、剪贴板、窗口辅助功能、字幕文件等输出统一事件。
- 为不同应用建立配置档案和自动匹配规则。
- 将术语表、去重、分句、翻译前后处理设计为可组合中间件。
- 日语场景可选增加原文、假名、分词和 Anki 导出。

**限制：**HOOK 与游戏内嵌翻译兼容性和维护成本高，不适合作为 LinguaLens 下一版首要目标；GPL 代码需按许可证边界处理。

## 6. eSearch

**第一手来源：**[README](https://github.com/xushengfeng/eSearch)、[Electron/TypeScript 清单](https://github.com/xushengfeng/eSearch/blob/master/package.json)。

它集成截屏、离线 OCR、搜索、翻译、贴图、屏幕翻译、滚动截屏和录屏。离线 OCR 基于 PaddleOCR 系方案，支持竖排、旋转、多语言和段落处理。屏幕翻译会生成贴图窗口，把图中文字替换为译文，并可定时刷新。

**LinguaLens 可借鉴：**

- 保留图像和文字框，让用户在覆盖前校正 OCR。
- 用“贴图 + 定时刷新”作为实时覆盖的低风险模式。
- 专业模式并列显示多个翻译结果，默认模式自动择优。
- ONNX OCR 模型作为可选下载组件，避免默认安装包过大。

**限制：**eSearch 范围很广，LinguaLens 不宜扩张成大而全截图工具；GPL 部分应独立实现。

## 7. WinLens

**第一手来源：**[README](https://github.com/marco-beltrame/WinLens)、[WPF 项目清单](https://github.com/marco-beltrame/WinLens/blob/main/WinLens.csproj)。

WinLens 捕获整个虚拟屏幕，OCR 后把译文按文字块覆盖在原文位置，并尽量匹配背景和字体。它支持多显示器和 DPI 精确截图，OCR 前约 2 倍放大；混合语言页面会运行多个 Windows OCR 识别器，按文字脚本筛选并去除重叠。翻译按行执行并缓存，Google 失败时回退 MyMemory。

**LinguaLens 可借鉴：**

- 将当前整块覆盖升级为每个 OCR 文字块独立覆盖。
- OCR 前自适应放大，提高小字号 UI 文本准确率。
- 混合脚本页面并行运行多个识别器，再按 Unicode 脚本和空间重叠合并。
- 对每行翻译做会话缓存；重复帧只更新变化文字块。
- 把多显示器、虚拟屏幕和 DPI 坐标列入自动测试。

**限制：**WinLens 当前没有区域框选，也不是自动持续刷新；LinguaLens 应组合其块级覆盖和自身已有框选能力。Windows OCR 依赖系统语言包，因此仍需 Tesseract/ONNX 回退。

## 对 LinguaLens 的优先建议

LinguaLens 当前是 Electron 43 + Tesseract.js 7，已有全局快捷键、区域截图、一次性 OCR/翻译、MyMemory/Google 回退、OpenAI 兼容服务、Ollama 和区域覆盖窗口。下一阶段最有价值的是提升 OCR 几何信息、持续刷新效率和覆盖质量，而不是继续堆翻译 API。

### P0：块级原位覆盖

1. OCR 返回每行/块的 `text`、`bbox`、`confidence` 和 `script`，不只返回拼接文本。
2. 翻译按行或语义块执行，并缓存标准化原文。
3. 覆盖层逐块渲染，采样背景色，估算字号、行高、对齐和前景色。
4. 保留纯文本结果窗口作为校对和失败回退模式。

### P0：Windows 原生 OCR 快路径

- Windows 10/11 默认优先 `Windows.Media.OCR`。
- Tesseract.js 作为不依赖系统语言包的回退。
- Paddle/RapidOCR ONNX 后续作为可选下载插件。
- 多引擎只在“高精度”模式启用，避免默认延迟和耗电上升。

### P1：低开销实时模式

- 固定一个或多个区域后，以可配置间隔捕获。
- 先计算缩小灰度图差异或感知哈希，无明显变化时跳过 OCR。
- 对动画字幕去抖，避免提交半成品。
- 原文未变化时跳过翻译，译文未变化时不重绘覆盖层。
- 提供捕获、OCR、翻译耗时和跳过次数诊断。

### P1：提供方与资源接口

- 统一 `capture`、`ocr`、`translate`、`postprocess` 接口与能力声明。
- 声明支持语言、离线能力、密钥需求、批量限制和是否返回文字框。
- 模型/语言包按需下载，包含 SHA-256、来源、版本和删除入口。
- 第一阶段先做内部接口，不急于开放可执行任意代码的插件市场。

### P2：多区域与应用配置档案

- 档案绑定目标进程/窗口标题、区域、语言、预处理、翻译服务和覆盖样式。
- 每个区域可命名为“对白”“菜单”“物品说明”，并使用独立刷新率。
- 窗口移动或 DPI 改变后按客户区比例重算，必要时提示重新校准。

## 许可证边界

LinguaLens 当前标为 MIT。以下仅是工程提示，不构成法律意见：

- **MIT：ScreenTranslator、MORT、WinLens。** 通常最容易在保留版权和许可证文本的前提下复用，但仍需逐文件检查第三方组件。
- **Apache-2.0：Translumo。** 复用时保留许可证/NOTICE 要求，并注意专利条款。
- **GPL-3.0：Pot、LunaTranslator、eSearch。** 如果 LinguaLens 希望继续采用 MIT 或闭源分发，建议只研究其行为、交互和架构，独立实现，不复制 GPL 代码或资源。
- OCR 模型、字体、图标、翻译接口和二进制运行库可能各有独立许可证或服务条款，实施前应建立第三方清单。

## 最终判断

现有开源项目分别验证了 LinguaLens 所需的关键能力，但没有一个样本同时把“轻量安装、一次框选、低延迟连续 OCR、多区域、混合语言识别、逐文字块原位覆盖、离线/在线提供方和安全密钥存储”全部做好。

最合理的差异化路线是：以 LinguaLens 现有一键框选为基础，吸收 WinLens 的块级覆盖、Translumo 的实时流水线、MORT 的多区域配置、Pot 的提供方接口和 eSearch 的可选 ONNX OCR。短期顺序应为：**块级 OCR 几何信息 → Windows OCR 快路径 → 变化检测实时循环 → 多区域配置档案**。
