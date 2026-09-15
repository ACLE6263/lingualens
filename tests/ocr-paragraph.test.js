const test = require('node:test');
const assert = require('node:assert/strict');

const { groupLinesIntoParagraphs } = require('../lib/ocr-layout');

function line(id, text, x, y, w, h, imageW = 1000, imageH = 1000) {
  return {
    id,
    text,
    confidence: 90,
    bbox: { x, y, width: w, height: h },
    relative: { x: x / imageW, y: y / imageH, width: w / imageW, height: h / imageH },
  };
}

test('wrapped paragraph lines merge into one block', () => {
  const lines = [
    line('l1', 'The quick brown fox jumps over', 100, 100, 400, 30),
    line('l2', 'the lazy dog near the river bank', 100, 136, 420, 30),
  ];
  const groups = groupLinesIntoParagraphs(lines, { width: 1000, height: 1000 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].text, 'The quick brown fox jumps over the lazy dog near the river bank');
  assert.equal(groups[0].bbox.y, 100);
  assert.equal(groups[0].bbox.height, 66);
});

test('list items with wide gaps stay separate', () => {
  const lines = [
    line('m1', 'New Task', 100, 100, 300, 32),
    line('m2', 'Open File', 100, 180, 300, 32),
  ];
  const groups = groupLinesIntoParagraphs(lines, { width: 1000, height: 1000 });
  assert.equal(groups.length, 2);
});

test('horizontally misaligned blocks stay separate', () => {
  const lines = [
    line('a', 'Left column text', 100, 100, 300, 30),
    line('b', 'Right column text here', 700, 132, 260, 30),
  ];
  const groups = groupLinesIntoParagraphs(lines, { width: 1000, height: 1000 });
  assert.equal(groups.length, 2);
});

test('CJK adjacent lines join without space', () => {
  const lines = [
    line('c1', '今天天气真好', 100, 100, 300, 36),
    line('c2', '我们去公园散步', 100, 142, 300, 36),
  ];
  const groups = groupLinesIntoParagraphs(lines, { width: 1000, height: 1000 });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].text, '今天天气真好我们去公园散步');
});

test('empty and invalid lines are ignored', () => {
  const groups = groupLinesIntoParagraphs([
    line('x', '', 0, 0, 10, 10),
    null,
    line('y', 'valid text', 50, 50, 200, 24),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].text, 'valid text');
});
