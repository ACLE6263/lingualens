const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const OPENING_PUNCTUATION = /[\uFF08(\[\u3010\u300C\u300E\u300A\u3008\u201C\u2018]/u;
const CLOSING_PUNCTUATION = /[\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A,.!?;:%\uFF05\uFF09)\]\u3011\u300D\u300F\u300B\u3009\u201D\u2019]/u;
const CJK_TRAILING_PUNCTUATION = /[\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A]/u;

function joinOcrWords(words) {
  return words.reduce((output, word) => {
    if (!output) return word;
    const previousCharacter = output.at(-1);
    const nextCharacter = word.at(0);
    const omitSpace = (CJK_CHARACTER.test(previousCharacter) && CJK_CHARACTER.test(nextCharacter))
      || OPENING_PUNCTUATION.test(previousCharacter)
      || CJK_TRAILING_PUNCTUATION.test(previousCharacter)
      || CLOSING_PUNCTUATION.test(nextCharacter);
    return `${output}${omitSpace ? '' : ' '}${word}`;
  }, '');
}
function parseTsvLayout(tsv, imageSize) {
  const width = Number(imageSize?.width);
  const height = Number(imageSize?.height);
  if (!tsv || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return [];
  }

  const lines = new Map();
  let segmentCounter = 0;
  // 拆分后同一 Tesseract 行的后续单词要接在当前段上，而不是回到原段。
  const currentSegmentId = new Map();
  const rows = String(tsv).split(/\r?\n/);
  for (const row of rows) {
    if (!row || row.startsWith('level\t')) continue;
    const columns = row.split('\t');
    if (columns.length < 12 || Number(columns[0]) !== 5) continue;

    const text = columns.slice(11).join('\t').trim();
    const confidence = Number(columns[10]);
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const wordWidth = Number(columns[8]);
    const wordHeight = Number(columns[9]);
    if (!text || !Number.isFinite(left) || !Number.isFinite(top)
      || !Number.isFinite(wordWidth) || !Number.isFinite(wordHeight)
      || wordWidth <= 0 || wordHeight <= 0 || confidence < 0) {
      continue;
    }

    const baseId = `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`;
    let id = currentSegmentId.get(baseId) ?? baseId;
    let line = lines.get(id);
    if (line) {
      // 同一条"行"里出现大横向空隙（超过 ~2.5 倍字高）：多半是左右并排的
      // 不同窗口/栏目被 Tesseract 归入一行。拆开成独立段，避免互相污染译文。
      const gap = left - line.lastRight;
      const gapLimit = Math.max(wordHeight * 2.5, 24);
      if (gap > gapLimit) {
        segmentCounter += 1;
        id = `${baseId}#${segmentCounter}`;
        line = null;
        currentSegmentId.set(baseId, id);
      }
    }
    if (!line) {
      line = {
        id,
        words: [],
        left,
        top,
        right: left + wordWidth,
        bottom: top + wordHeight,
        lastRight: left + wordWidth,
        confidenceTotal: 0,
        confidenceCount: 0,
      };
      lines.set(id, line);
      if (!currentSegmentId.has(baseId) || currentSegmentId.get(baseId) === id) {
        currentSegmentId.set(baseId, id);
      }
    }
    line.words.push(text);
    line.left = Math.min(line.left, left);
    line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + wordWidth);
    line.bottom = Math.max(line.bottom, top + wordHeight);
    line.lastRight = left + wordWidth;
    line.confidenceTotal += confidence;
    line.confidenceCount += 1;
  }

  return [...lines.values()].map((line) => {
    const bbox = {
      x: line.left,
      y: line.top,
      width: line.right - line.left,
      height: line.bottom - line.top,
    };
    return {
      id: line.id,
      text: joinOcrWords(line.words),
      confidence: Math.round(line.confidenceTotal / line.confidenceCount),
      bbox,
      relative: {
        x: bbox.x / width,
        y: bbox.y / height,
        width: bbox.width / width,
        height: bbox.height / height,
      },
    };
  });
}

const CJK_TRAILING = /[\u4e00-\u9fff\u3040-\u30ff]$/;
const CJK_LEADING = /^[\u4e00-\u9fff\u3040-\u30ff]/;

function joinAdjacentLines(firstText, secondText) {
  if (!firstText) return secondText;
  if (CJK_TRAILING.test(firstText) && CJK_LEADING.test(secondText)) return `${firstText}${secondText}`;
  return `${firstText} ${secondText}`;
}

// 全屏 OCR 会把桌面图标、任务栏等非文本区域读成符号汤（如 "s ¥ Sa. 2 | F: Lg
// 5 ®..."），这些行没有翻译价值，硬翻只会产生幻觉词汤铺满覆盖层。
// 判据：有效字符（字母/数字/CJK）至少 2 个、有效字符占比 ≥ 50%、
// OCR 平均置信度 ≥ 50。
// 地址栏/文件路径类文本（URL、盘符路径）翻译没有意义，直接跳过。
function isUrlLikeText(value) {
  const lowered = value.toLowerCase();
  const urlHits = (lowered.match(/(https?:\/\/|www\.|\.(html?|js|css|json)\b|[a-z]:[\\/][a-z])/g) ?? []).length;
  return urlHits >= 1 && /[a-z]/.test(lowered);
}

function isTranslatableLine(text, confidence) {
  const value = String(text ?? '');
  const useful = value.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  if (useful < 2) return false;
  if (isUrlLikeText(value)) return false;
  if (useful / value.length < 0.5) return false;
  // 纯拉丁字母的两三个字符（"TN"、"ee"、"m EY"这类图标碎片）没有翻译价值
  const hasCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff]/.test(value);
  if (!hasCjk && useful < 3) return false;
  if (Number.isFinite(confidence) && confidence > 0 && confidence < 50) return false;
  return true;
}

// 把 OCR 行合并成段落块：垂直间距小于行高的行（同一段换行）、且水平范围
// 对齐的，合并为一个翻译单元。逐行翻译会把完整句子拦腰截断（译文质量差），
// 且每行的译文长度与原文不匹配、折行后互相压盖，覆盖层无法阅读。
// 菜单/列表项行距通常 ≥ 1 倍行高，不会被并进段落。
function groupLinesIntoParagraphs(lines, imageSize, {
  maxGapRatio = 0.7,
  minOverlapRatio = 0.25,
} = {}) {
  const sorted = [...(Array.isArray(lines) ? lines : [])]
    .filter((line) => line?.text?.trim() && line.bbox && line.relative
      && isTranslatableLine(line.text, line.confidence))
    .sort((a, b) => (a.bbox.top - b.bbox.top) || (a.bbox.left - b.bbox.left));

  const groups = [];
  let current = null;
  for (const line of sorted) {
    if (!current) {
      current = {
        lines: [line],
        bbox: {
          left: line.bbox.x,
          right: line.bbox.x + line.bbox.width,
          top: line.bbox.y,
          bottom: line.bbox.y + line.bbox.height,
        },
        avgLineHeight: line.bbox.height,
      };
      groups.push(current);
      continue;
    }
    const bbox = current.bbox;
    const overlap = Math.min(bbox.right, line.bbox.x + line.bbox.width) - Math.max(bbox.left, line.bbox.x);
    const narrower = Math.min(bbox.right - bbox.left, line.bbox.width);
    const lineHeight = Math.min(
      line.bbox.height,
      current.avgLineHeight,
    );
    const verticalGap = line.bbox.y - bbox.bottom;
    const heightRatio = line.bbox.height / current.avgLineHeight;
    const shouldMerge = overlap >= narrower * minOverlapRatio
      && verticalGap <= lineHeight * maxGapRatio
      && verticalGap >= -lineHeight
      && heightRatio >= 0.55
      && heightRatio <= 1.8;
    if (shouldMerge) {
      current.lines.push(line);
      const merged = current.lines;
      current.bbox = {
        left: Math.min(...merged.map((item) => item.bbox.x)),
        right: Math.max(...merged.map((item) => item.bbox.x + item.bbox.width)),
        top: Math.min(...merged.map((item) => item.bbox.y)),
        bottom: Math.max(...merged.map((item) => item.bbox.y + item.bbox.height)),
      };
      current.avgLineHeight = merged.reduce(
        (sum, item) => sum + item.bbox.height, 0,
      ) / merged.length;
    } else {
      current = {
        lines: [line],
        bbox: {
          left: line.bbox.x,
          right: line.bbox.x + line.bbox.width,
          top: line.bbox.y,
          bottom: line.bbox.y + line.bbox.height,
        },
        avgLineHeight: line.bbox.height,
      };
      groups.push(current);
    }
  }

  // 合并后仍可能是符号汤（多行垃圾拼接），最终再过滤一次。
  return groups
    .filter((group) => isTranslatableLine(
      group.lines.map((line) => line.text).join(' '),
    ))
    .map((group, index) => {
    const bbox = {
      x: group.bbox.left,
      y: group.bbox.top,
      width: group.bbox.right - group.bbox.left,
      height: group.bbox.bottom - group.bbox.top,
    };
    const imageWidth = Number(imageSize?.width);
    const imageHeight = Number(imageSize?.height);
    const hasImageSize = Number.isFinite(imageWidth) && imageWidth > 0
      && Number.isFinite(imageHeight) && imageHeight > 0;
    return {
      id: `para-${index}-${group.lines[0].id}`,
      text: group.lines.reduce((text, line) => joinAdjacentLines(text, line.text), ''),
      confidence: Math.round(
        group.lines.reduce((sum, line) => sum + line.confidence, 0) / group.lines.length,
      ),
      bbox,
      relative: hasImageSize ? {
        x: bbox.x / imageWidth,
        y: bbox.y / imageHeight,
        width: bbox.width / imageWidth,
        height: bbox.height / imageHeight,
      } : { ...group.lines[0].relative },
    };
  });
}

module.exports = { groupLinesIntoParagraphs, joinOcrWords, parseTsvLayout };
