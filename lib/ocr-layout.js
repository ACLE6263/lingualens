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

    const id = `${columns[1]}-${columns[2]}-${columns[3]}-${columns[4]}`;
    let line = lines.get(id);
    if (!line) {
      line = {
        id,
        words: [],
        left,
        top,
        right: left + wordWidth,
        bottom: top + wordHeight,
        confidenceTotal: 0,
        confidenceCount: 0,
      };
      lines.set(id, line);
    }
    line.words.push(text);
    line.left = Math.min(line.left, left);
    line.top = Math.min(line.top, top);
    line.right = Math.max(line.right, left + wordWidth);
    line.bottom = Math.max(line.bottom, top + wordHeight);
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

module.exports = { joinOcrWords, parseTsvLayout };
