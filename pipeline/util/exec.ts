import { spawn, spawnSync } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

/** Run a command, capture output. Never throws unless `check` is set. */
export const run = (cmd: string, args: string[], opts: { check?: boolean; cwd?: string } = {}): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) => (opts.check ? reject(e) : resolve({ code: 127, stdout, stderr: String(e) })));
    p.on('close', (code) => {
      const r = { code: code ?? 1, stdout, stderr };
      if (opts.check && r.code !== 0) {
        reject(new Error(`${cmd} ${args.join(' ')}\n  exited ${r.code}\n${stderr.split('\n').slice(-15).join('\n')}`));
      } else resolve(r);
    });
  });

/** Run with inherited stdio (for installers the user should see). */
export const runLive = (cmd: string, args: string[], cwd?: string): Promise<number> =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit' });
    p.on('error', () => resolve(127));
    p.on('close', (code) => resolve(code ?? 1));
  });

export const which = (cmd: string): string | null => {
  const r = spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
