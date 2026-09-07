import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const validPreflightId = id => typeof id === 'string' && /^MT-[A-F0-9]{24}$/.test(id);
export const preflightLockPath = (directory, id) => {
  if (!validPreflightId(id)) throw new Error('Invalid preflight ID');
  return path.join(directory, `.${id}.lock`);
};
export function isPreflightRunning(directory, id, now = Date.now()) {
  if (!directory || !validPreflightId(id)) return false;
  try {
    const stat = lstatSync(preflightLockPath(directory, id));
    return stat.isFile() && now >= stat.mtimeMs - 1000 && now - stat.mtimeMs < 75000;
  } catch { return false; }
}

// Both scheduled and immediate workers own the same per-request lock. Recovery
// is serialized, and release checks inode ownership before removing a lock.
export function acquirePreflightLock(lock, recovery = lock + '.recovery') {
  let descriptor;
  try { descriptor = openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    try { mkdirSync(recovery, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') return null; throw error; }
    try {
      try {
        if (Date.now() - lstatSync(lock).mtimeMs <= 5 * 60000) return null;
        unlinkSync(lock);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { descriptor = openSync(lock, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') return null; throw error; }
    } finally { rmdirSync(recovery); }
  }
  const owned = fstatSync(descriptor);
  return () => {
    closeSync(descriptor);
    try {
      const current = lstatSync(lock);
      if (current.ino === owned.ino && current.dev === owned.dev) unlinkSync(lock);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
