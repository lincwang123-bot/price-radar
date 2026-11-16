// Local, reviewable ledger update. No network or database writes.
import {readFileSync,writeFileSync} from 'node:fs';
import {readGeminiReviews,validateGeminiReview} from '../lib/gemini-eligibility.mjs';
const input=process.argv[2];
if(!input)throw Error('Usage: node scripts/gemini-review.mjs <review.json>');
const record=validateGeminiReview(JSON.parse(readFileSync(input,'utf8')));
const records=readGeminiReviews();
records.push(record);
writeFileSync(new URL('../config/gemini-reviews.json',import.meta.url),JSON.stringify(records,null,2)+'\n');
console.log('Recorded Gemini review; inspect and commit config/gemini-reviews.json.');
