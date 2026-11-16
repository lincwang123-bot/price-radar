import test from 'node:test';
import assert from 'node:assert/strict';
import {offerSpec} from '../lib/offer-spec.mjs';
const spec=title=>offerSpec({title,currency:'CNY'},{product_id:'chatgpt-plus'});
test('30-day monthly card is one explicit duration; perpetual redemption is not perpetual membership',()=>{
  for(const title of [
    'ChatGPT Plus 官方充值30天月卡直充自己号(可囤，卡密永久有效)质保30天',
    'ChatGPT Plus 代充 30 天月卡 新开续费均可',
    'ChatGPT Plus 30日月卡 代充 新开续费均可 CDK永久有效',
  ]){
    const s=spec(title);assert.equal(s.known,true,title);assert.equal(s.purchase_conditions.subscriptionTerm,'30d',title);
    assert.doesNotMatch(s.label,/期限\/组合待确认/);
  }
  const incomplete=spec('ChatGPT Plus 官方充值30天月卡直充自己号(可囤，卡密永久有效)质保30天');
  assert.equal(incomplete.comparison_eligible,false);
  assert.deepEqual(incomplete.purchase_conditions.reasons,['新开或续费条件未注明']);
  assert.equal(spec('ChatGPT Plus 月卡 代充 新开续费均可 质保30天').purchase_conditions.subscriptionTerm,'1m');
  for(const title of ['ChatGPT Plus 永久会员 代充','ChatGPT Plus 30天/月卡 代充','ChatGPT Plus 7天月卡 代充','ChatGPT Plus 30天月卡 或年卡 代充'])assert.equal(spec(title).known,false,title);
  assert.equal(spec('ChatGPT Plus 代充 卡密永久有效').purchase_conditions.subscriptionTerm,'unknown');
});
test('negative trial descriptions do not change monthly accounts into trial groups',()=>{
  for(const term of ['非日抛','不是试用号','不属于体验账号','non-trial','not a trial']) {
    const s=spec(`ChatGPT Plus 月卡成品号（${term}）`);
    assert.doesNotMatch(s.label,/试用\/短期/);assert.equal(s.known,true);
  }
  assert.match(spec('ChatGPT Plus 7天成品号 试用').label,/试用\/短期/);
});
test('estimated lifetimes and deadlines cannot qualify as subscription durations',()=>{
  for(const title of ['claude max x20 速刷号！号池专供账号，差不多1天内，但是不打包票！个人勿拍！','ChatGPT Plus 成品号 大约3天','ChatGPT Plus 成品号 3天左右','ChatGPT Plus 成品号 2天内','ChatGPT Plus 成品号 about 3 days']) {
    const s=spec(title);assert.equal(s.known,false,title);assert.equal(s.comparison_eligible,false,title);
    assert.equal(s.purchase_conditions.quality,'C');
  }
  for(const title of ['ChatGPT Plus 成品号 有效期1天','ChatGPT Plus 3天成品号','ChatGPT Plus 月卡成品号，2天内发货'])assert.equal(spec(title).known,true,title);
});
