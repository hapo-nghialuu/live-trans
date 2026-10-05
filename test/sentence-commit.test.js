import test from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceCommitter, splitSentences, normalize } from '../server/sentence-commit.js';

const S1 = 'Kính thưa quý vị đại biểu.';
const S2 = 'Mười năm trước, chúng tôi bắt đầu từ một văn phòng nhỏ.';
const S3 = 'Hôm nay công ty đã có hơn 70 thành viên.';

test('sentence splitting keeps numbers and closing quotes intact', () => {
  assert.deepEqual(splitSentences('Doanh thu tăng 1.000 lần. Thật sao? "Đúng vậy!" còn'),
    { sentences: ['Doanh thu tăng 1.000 lần.', 'Thật sao?', '"Đúng vậy!"'], tail: 'còn' });
  assert.equal(normalize('các bạn.Chào mừng'), 'các bạn. Chào mừng');
  assert.equal(normalize('giá 3.5 triệu'), 'giá 3.5 triệu');
});

test('sentences commit while the speaker keeps talking', () => {
  const c = createSentenceCommitter();
  assert.deepEqual(c.interim('Kính thưa quý vị', 0), []);
  // The first sentence is held while it is the last thing said...
  assert.deepEqual(c.interim(S1, 100), []);
  // ...and commits as soon as more speech follows it.
  assert.deepEqual(c.interim(`${S1} Mười năm`, 200), [S1]);
  assert.deepEqual(c.interim(`${S1} ${S2} Hôm`, 300), [S2]);
  assert.equal(c.pending(), 'Hôm');
  // The final transcript only adds what was not committed yet.
  assert.deepEqual(c.final(`${S1} ${S2} ${S3}`), [S3]);
});

test('a trailing sentence commits after the transcript settles', () => {
  const c = createSentenceCommitter({ stableMs: 700 });
  assert.deepEqual(c.interim(`${S1} ${S2}`, 1000), [S1], 'S1 is followed by speech, so it commits at once');
  assert.deepEqual(c.settle(1500), [], 'S2 is still the last thing said and may change');
  assert.deepEqual(c.settle(1700), [S2]);
  assert.deepEqual(c.final(`${S1} ${S2}`), [], 'nothing repeated when the turn closes');
});

test('missing space after a full stop does not drop the next word', () => {
  const c = createSentenceCommitter();
  assert.deepEqual(c.interim('Xin chào quý vị.Chào mừng mọi người', 0), ['Xin chào quý vị.']);
  assert.equal(c.pending(), 'Chào mừng mọi người');
});

test('final revisions neither repeat nor drop committed sentences', () => {
  const c = createSentenceCommitter();
  c.interim('Chào mừng đến Ha To Su. Mười năm trước chúng tôi', 0);
  // The ASR fixes the spelling of a committed word and adds one more sentence.
  assert.deepEqual(c.final('Chào mừng đến Hatsusut. Mười năm trước chúng tôi bắt đầu. Cảm ơn.'),
    ['Mười năm trước chúng tôi bắt đầu. Cảm ơn.']);
});

test('long speech without punctuation is cut at a comma', () => {
  const c = createSentenceCommitter({ maxChars: 60 });
  const text = 'chúng tôi muốn gửi lời cảm ơn tới các đối tác, các khách hàng và toàn thể nhân viên công ty đã luôn đồng hành';
  const out = c.interim(text, 0);
  assert.equal(out.length, 1);
  assert.ok(out[0].endsWith('các đối tác,'), out[0]);
  assert.equal(c.pending(), 'các khách hàng và toàn thể nhân viên công ty đã luôn đồng hành');
});

test('flush returns only the uncommitted text of an abandoned turn', () => {
  const c = createSentenceCommitter();
  c.interim(`${S1} ${S2} Hôm nay`, 0);
  assert.deepEqual(c.flush(), ['Hôm nay']);
  assert.deepEqual(c.interim(`${S3} Xin`, 10), [S3], 'the next turn starts from zero');
});

test('each turn starts fresh after its final transcript', () => {
  const c = createSentenceCommitter();
  c.interim(`${S1} ${S2} còn`, 0);
  c.final(`${S1} ${S2} còn tiếp.`);
  assert.deepEqual(c.interim(`${S3} Xin`, 10), [S3]);
});
