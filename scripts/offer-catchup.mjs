#!/usr/bin/env node
// 切换精简库时，补上备份冻结点之后新写入的行情。
// 冻结点：2026-11-06 10:16 北京时间。导出使用只读连接。
//   node scripts/offer-catchup.mjs export --source /backup/radar.sqlite --since "2026-11-06 10:16" --out /mnt/catchup.sqlite
//   node scripts/offer-catchup.mjs merge --from /mnt/catchup.sqlite --into /mnt/radar-slim.sqlite
import path from 'node:path';
import {exportOfferChanges, mergeOfferChanges, parseSince} from '../lib/offer-catchup.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}
const command = process.argv.find(item => item === 'export' || item === 'merge');
if (!command || process.argv.includes('--help')) {
  console.log(`用法:
  node scripts/offer-catchup.mjs export --source 生产库或其后的副本 --since "2026-11-06 10:16" --out 补录文件.sqlite
  node scripts/offer-catchup.mjs merge --from 补录文件.sqlite --into 精简库.sqlite

--since 不带时区时按北京时间。也会接受 ISO。
导出的是该时刻及之后的 snapshots / products / offers，以及更晚的 alerts、rule_state 和 health:* 元数据。
不会导出或覆盖瘦身自己的水位（offer_detail_before 等）。`);
  process.exit(command ? 0 : 1);
}

if (command === 'export') {
  const source = path.resolve(arg('--source', ''));
  const out = path.resolve(arg('--out', ''));
  if (!source || !out) throw new Error('export 需要 --source 和 --out');
  console.log(JSON.stringify(exportOfferChanges(source, out, parseSince(arg('--since', ''))), null, 2));
} else {
  const from = path.resolve(arg('--from', ''));
  const into = path.resolve(arg('--into', ''));
  if (!from || !into) throw new Error('merge 需要 --from 和 --into');
  console.log(JSON.stringify(mergeOfferChanges(into, from), null, 2));
}
