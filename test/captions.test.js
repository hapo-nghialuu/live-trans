import test from 'node:test';
import assert from 'node:assert/strict';
import { Captions } from '../public/captions.js';

// The test exercises display transitions; upstream AI is not involved.
function screen(t) {
  const nodes = new Map();
  const element = () => ({ textContent: '', hidden: false, children: [],
    classList: { toggle() {} }, append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; } });
  const previous = globalThis.document;
  globalThis.document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element,
  };
  t.after(() => { globalThis.document = previous; });
  return { captions: new Captions(), text: id => nodes.get(id).textContent, nodes };
}

test('audience empty states use English and Japanese', t => {
  const { captions, text, nodes } = screen(t);
  captions.reset();
  assert.equal(text('caption-en'), 'Waiting for the speaker…');
  assert.equal(text('caption-ja'), '開始までお待ちください…');
  assert.equal(nodes.get('caption-progress').hidden, true);
});

test('previous translation remains readable during new speech and translation', t => {
  const { captions, text, nodes } = screen(t);
  captions.reset([{ id: 1, vi: 'Chào mọi người', en: 'Welcome, everyone.', ja: '皆さま、ようこそ。', status: 'done' }]);
  captions.setInterim('Cảm ơn');
  assert.equal(text('caption-en'), 'Welcome, everyone.');
  assert.equal(text('caption-ja'), '皆さま、ようこそ。');
  assert.equal(text('caption-vi'), 'Cảm ơn');
  captions.setInterim('');
  captions.update({ id: 2, vi: 'Cảm ơn đã đến', status: 'translating' });
  assert.equal(text('caption-en'), 'Welcome, everyone.');
  assert.equal(nodes.get('caption-progress').hidden, false);
  captions.update({ id: 2, vi: 'Cảm ơn đã đến', en: 'Thank you for joining us.', ja: 'ご参加ありがとうございます。', status: 'done' });
  assert.equal(text('caption-en'), 'Welcome, everyone.\n\nThank you for joining us.');
  assert.equal(text('caption-ja'), '皆さま、ようこそ。\n\nご参加ありがとうございます。');
  assert.equal(nodes.get('caption-progress').hidden, true);
});

test('failed translation retains earlier text and displays an audience error', t => {
  const { captions, text, nodes } = screen(t);
  captions.reset([{ id: 1, en: 'Welcome.', ja: 'ようこそ。', status: 'done' }]);
  captions.update({ id: 2, vi: 'Câu tiếp theo', status: 'error' });
  assert.equal(text('caption-en'), 'Welcome.');
  assert.equal(text('caption-ja'), 'ようこそ。');
  assert.match(text('caption-progress'), /Translation temporarily unavailable/);
  assert.equal(nodes.get('caption-progress').hidden, false);
});


test('history stays chronological and updates a sentence without duplication', t => {
  const { captions, text } = screen(t);
  captions.reset([{ id: 1, en: 'One', ja: '一' }, { id: 2, en: 'Two', ja: '二' }]);
  captions.update({ id: 2, en: 'Two updated', ja: '二 更新' });
  captions.update({ id: 3, en: 'Three', ja: '三' });
  assert.equal(text('caption-en'), 'One\n\nTwo updated\n\nThree');
  assert.equal(text('caption-ja'), '一\n\n二 更新\n\n三');
  captions.reset([{ id: 9, en: 'New room', ja: '新しい部屋' }]);
  assert.equal(text('caption-en'), 'New room');
});
