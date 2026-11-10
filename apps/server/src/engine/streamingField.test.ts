import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StreamingStringField } from './streamingField';

function feed(fragments: string[], key = 'text'): string[] {
  const field = new StreamingStringField(key);
  return fragments.map((fragment) => field.push(fragment));
}

test('text becomes readable as soon as it arrives', () => {
  assert.deepEqual(feed(['{"te', 'xt": "Rain ', 'falls', '."}']), ['', 'Rain ', 'falls', '.']);
});

test('escapes split across fragments are held until complete', () => {
  const json = JSON.stringify({ text: 'One.\n\n"Two," she says.\tThree\\' });
  for (let size = 1; size <= 7; size++) {
    const fragments = json.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [];
    assert.equal(feed(fragments).join(''), 'One.\n\n"Two," she says.\tThree\\', `fragment size ${size}`);
  }
});

test('unicode escapes and unescaped CJK both come through', () => {
  assert.equal(feed(['{"text":"\\u96', 'e8', '已经跟了你三天\\ud83c\\udf27"}']).join(''), '雨已经跟了你三天🌧');
});

test('reading stops at the end of the string, whatever follows', () => {
  assert.deepEqual(feed(['{"text":"Done."', ',"extra":"ignored"}']), ['Done.', '']);
});

test('an object that does not open with the key yields nothing', () => {
  assert.equal(feed(['{"other":"x","text":"hidden"}']).join(''), '');
});
