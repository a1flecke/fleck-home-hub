import { spawn } from 'node:child_process';

export async function runDatabaseWorkers(script: string, args: string[][]) {
  const timeout = 4_000;
  const signal = AbortSignal.timeout(timeout);
  const workers = args.map(values => spawn(process.execPath, ['--import', 'tsx', script, ...values], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], signal, killSignal: 'SIGKILL',
  }));
  const waiting = new Set(workers);
  const closed = workers.map(worker => new Promise<void>(resolve => worker.once('close', () => resolve())));

  try {
    return await Promise.all(workers.map(worker => new Promise<string>((resolve, reject) => {
      let outcome: string | undefined;
      let stderr = '';
      worker.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      worker.once('error', error => {
        reject(signal.aborted ? new Error(`${script} exceeded its ${timeout} ms deadline`, { cause: error }) : error);
      });
      worker.on('message', message => {
        if (message === 'ready') {
          if (waiting.delete(worker) && waiting.size === 0) {
            for (const peer of workers) peer.send('go', error => { if (error) reject(error); });
          }
        } else if (typeof message === 'string') {
          outcome = message;
        }
      });
      worker.once('close', (code, exitSignal) => {
        if (!waiting.has(worker) && code === 0 && outcome !== undefined) {
          resolve(outcome);
          return;
        }
        const phase = waiting.has(worker) ? 'readiness' : 'completion';
        reject(new Error(`${script} exited before ${phase} (${exitSignal ?? `code ${code}`})\n${stderr.trim()}`.trimEnd()));
      });
    })));
  } finally {
    for (const worker of workers) {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
    }
    await Promise.all(closed);
  }
}
