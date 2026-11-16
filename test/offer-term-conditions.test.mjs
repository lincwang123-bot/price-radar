import test from 'node:test';
import assert from 'node:assert/strict';
import {offerSpec} from '../lib/offer-spec.mjs';

test('renewal eligibility is not the purchased subscription duration', () => {
  const title = '【官方充值】菲区 GPT Pro 20x CDK 卡充临期续费专用自动换绑卡续订（只限三天内到期账号）';
  const spec = offerSpec({title, currency:'CNY'});
  assert.equal(spec.key.split(':')[0], 'unknown');
  assert.equal(spec.known, false);
  assert.match(spec.label, /期限未注明/);
});

test('advance booking windows do not conflict with an explicit monthly subscription', () => {
  const title = 'ChatGPT Pro 20X｜1个月｜续费订阅专用【正规充值】【提前1-2天预定】';
  const spec = offerSpec({title, currency:'CNY'});
  assert.equal(spec.key.split(':')[0], '1m');
  assert.equal(spec.known, true);
});

test('timing conditions preserve real short subscriptions and ambiguous ranges', () => {
  for (const condition of ['到期前3天', '剩余三天以内', '3天内发货', '提前2天预约']) {
    assert.equal(offerSpec({title:`ChatGPT Pro 20x 代充月卡（${condition}）`}).key.split(':')[0], '1m', condition);
  }
  assert.equal(offerSpec({title:'ChatGPT Plus 3天代充'}).key.split(':')[0], '3d');
  assert.equal(offerSpec({title:'ChatGPT Plus 1-2天代充'}).key.split(':')[0], 'ambiguous');
  assert.equal(offerSpec({title:'ChatGPT Plus 月卡 3天质保'}).key.split(':')[0], '1m');
});
