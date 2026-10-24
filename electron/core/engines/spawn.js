'use strict';
/**
 * 子进程流式执行：把系统工具的输出实时解析成进度事件，并支持取消。
 */
const { spawn } = require('child_process');

function spawnStep(cmd, args, { onLine, onStderr, signal, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8', ...(env || {}) },
      windowsHide: true,
    });

    let stdoutTail = '';
    let stderrTail = '';
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 3000);
      } catch {}
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const pump = (stream, isErr) => {
      let bufStr = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        bufStr += chunk;
        const parts = bufStr.split(/[\r\n]+/);
        bufStr = parts.pop() || '';
        for (const line of parts) {
          if (!line.trim()) continue;
          if (isErr) stderrTail = (stderrTail + line + '\n').slice(-4000);
          else stdoutTail = (stdoutTail + line + '\n').slice(-4000);
          try {
            (isErr ? onStderr : onLine)?.(line);
          } catch {}
        }
      });
      stream.on('end', () => {
        if (bufStr.trim()) {
          if (isErr) stderrTail = (stderrTail + bufStr + '\n').slice(-4000);
          else stdoutTail = (stdoutTail + bufStr + '\n').slice(-4000);
          try {
            (isErr ? onStderr : onLine)?.(bufStr);
          } catch {}
        }
      });
    };

    pump(child.stdout, false);
    pump(child.stderr, true);

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      const err = new Error(`无法启动 ${cmd}：${e.message}`);
      err.code = 'SPAWN_FAILED';
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      if (signal?.aborted) {
        return reject(Object.assign(new Error('用户已取消'), { code: 'CANCELLED' }));
      }
      if (code === 0) return resolve({ stdout: stdoutTail, stderr: stderrTail });
      const err = new Error(
        `${cmd} 执行失败（退出码 ${code}）${stderrTail ? '：' + stderrTail.trim().split('\n').slice(-3).join(' ') : ''}`
      );
      err.code = 'STEP_FAILED';
      err.stdout = stdoutTail;
      err.stderr = stderrTail;
      reject(err);
    });
  });
}

/** 从任意一行输出里抓百分比 */
function pctFrom(line) {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
}

/** 命令是否存在 */
async function hasCommand(cmd) {
  const { run } = require('../util');
  const probe = process.platform === 'win32' ? ['where', [cmd]] : ['sh', ['-c', `command -v ${cmd} || true`]];
  const r = await run(probe[0], probe[1], { timeout: 5000 });
  return r.ok && r.stdout.trim().length > 0;
}

module.exports = { spawnStep, pctFrom, hasCommand };
