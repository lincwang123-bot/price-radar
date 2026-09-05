import test from "node:test";
import assert from "node:assert/strict";
import { validatePriceaiPointer } from "../sources/priceai.mjs";
test("PriceAI 指针拒绝任意主机、凭据、路径穿越和 ID 不匹配",()=>{
  const good={snapshot_id:"20260905-abc",snapshot_url:"https://data.priceai.cc/v1/snapshots/20260905-abc.json"};
  assert.equal(validatePriceaiPointer(good),good);
  for(const p of [{...good,snapshot_id:"../../secret"},{...good,snapshot_url:"http://127.0.0.1/"},{...good,snapshot_url:"https://data.priceai.cc/v1/snapshots/other.json"},{...good,snapshot_url:good.snapshot_url+"?redirect=evil"},{...good,snapshot_url:"https://u:p@data.priceai.cc/v1/snapshots/20260905-abc.json"}]) assert.throws(()=>validatePriceaiPointer(p));
});
