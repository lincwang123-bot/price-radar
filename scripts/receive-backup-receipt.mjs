import {writeReceipt} from '../lib/offsite-backup.mjs';
process.umask(0o077);
try {
  let input='';
  for await(const chunk of process.stdin){input+=chunk.toString();if(Buffer.byteLength(input)>2048)throw new Error('Receipt too large');}
  writeReceipt(JSON.parse(input));
}catch{console.error('Backup receipt rejected');process.exitCode=1;}
