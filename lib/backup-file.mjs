import {createReadStream, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Database archives can exceed Node's single-Buffer size and available RAM.
export async function backupFileDigest(file, {signal} = {}) {
  if (!lstatSync(file).isFile()) throw new Error('Backup input must be a regular file');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file, {highWaterMark: 1024 * 1024, signal})) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return {bytes, sha256: hash.digest('hex')};
}
