const test = require('node:test');
const assert = require('node:assert/strict');

const { joinOcrWords, parseTsvLayout } = require('../lib/ocr-layout');

const TSV = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
1\t1\t0\t0\t0\t0\t0\t0\t900\t300\t-1\t
4\t1\t1\t1\t1\t0\t23\t28\t470\t30\t-1\t
5\t1\t1\t1\t1\t1\t23\t28\t98\t30\t96.2\tHello
5\t1\t1\t1\t1\t2\t135\t35\t132\t23\t94.8\tscreen
5\t1\t1\t1\t1\t3\t282\t28\t211\t30\t95.0\ttranslation
4\t1\t1\t1\t2\t0\t21\t73\t222\t20\t-1\t
5\t1\t1\t1\t2\t1\t21\t73\t98\t20\t93.0\tSecond
5\t1\t1\t1\t2\t2\t131\t73\t45\t20\t97.0\tline
5\t1\t1\t1\t2\t3\t187\t73\t56\t20\t96.0\there`;

test('parseTsvLayout returns ordered OCR lines with geometry', () => {
  const layout = parseTsvLayout(TSV, { width: 900, height: 300 });

  assert.equal(layout.length, 2);
  assert.deepEqual(layout[0], {
    id: '1-1-1-1',
    text: 'Hello screen translation',
    confidence: 95,
    bbox: { x: 23, y: 28, width: 470, height: 30 },
    relative: {
      x: 23 / 900,
      y: 28 / 300,
      width: 470 / 900,
      height: 30 / 300,
    },
  });
  assert.equal(layout[1].text, 'Second line here');
  assert.deepEqual(layout[1].bbox, { x: 21, y: 73, width: 222, height: 20 });
});

test('parseTsvLayout ignores empty and invalid words', () => {
  const tsv = `${TSV}\n5\t1\t1\t1\t3\t1\t0\t0\t10\t10\t-1\t   `;
  assert.equal(parseTsvLayout(tsv, { width: 900, height: 300 }).length, 2);
});

test('joinOcrWords preserves mixed-script spacing', () => {
  assert.equal(joinOcrWords(['Hello', 'screen']), 'Hello screen');
  assert.equal(joinOcrWords(['屏幕', '翻译', '工具']), '屏幕翻译工具');
  assert.equal(joinOcrWords(['打开', 'Settings']), '打开 Settings');
  assert.equal(joinOcrWords(['你好', '，', 'world', '!']), '你好，world!');
});
