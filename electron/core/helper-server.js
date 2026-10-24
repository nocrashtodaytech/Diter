'use strict';
/**
 * 提权助手服务端（在 --elevated 的 headless 进程内运行）。
 *
 * 主窗口（非 root）把写盘任务通过本地 Unix socket 委托给本进程执行，
 * 本进程以 root 运行，复用 writer.js 的完整写入逻辑，并把进度事件回传。
 * 这样授权后「原窗口保持不变」，无需重启、无需重新选择镜像/设备。
 */
const net = require('net');
const fs = require('fs');
const writer = require('./writer');

const SOCK = process.platform === 'win32' ? '\\\\.\\pipe\\diter-helper' : '/tmp/diter-helper.sock';

function handle(msg, socket) {
  const reply = (o) => {
    try {
      socket.write(JSON.stringify(o) + '\n');
    } catch {}
  };

  switch (msg.t) {
    case 'ping':
      reply({
        t: 'pong',
        id: msg.id,
        // 返回实际 uid，供主窗口确认助手是否真的以 root 运行（Unix）
        uid: typeof process.getuid === 'function' ? process.getuid() : null,
      });
      break;
    case 'start':
      try {
        writer
          .start({
            ...msg.payload,
            emit: (e) => reply({ t: 'event', event: e }),
          })
          .then(({ jobId }) => reply({ t: 'started', id: msg.id, jobId }))
          .catch((e) => reply({ t: 'error', id: msg.id, message: e.message }));
      } catch (e) {
        reply({ t: 'error', id: msg.id, message: e.message });
      }
      break;
    case 'cancel':
      writer.cancel(msg.jobId);
      break;
    case 'format':
      // 只做分区 + 格式化（磁盘管理操作），文件级拷贝由主进程（用户会话）执行
      require('./engines/windows-media')
        .partition({ id: msg.deviceId }, () => {})
        .then((mountPoint) => reply({ t: 'result', id: msg.id, mountPoint }))
        .catch((e) => reply({ t: 'error', id: msg.id, message: e.message }));
      break;
    case 'eject':
      writer
        .eject(msg.deviceId)
        .then((r) => reply({ t: 'result', id: msg.id, r }))
        .catch((e) => reply({ t: 'error', id: msg.id, message: e.message }));
      break;
    case 'shutdown':
      reply({ t: 'bye', id: msg.id });
      setTimeout(() => process.exit(0), 100);
      break;
  }
}

function startServer() {
  const log = (msg) => {
    try {
      fs.appendFileSync('/tmp/diter-helper.log', `${msg}\n`);
    } catch {}
  };

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        handle(m, socket);
      }
    });
    socket.on('error', () => {});
  });

  server.on('error', (e) => {
    log(`server error: ${e.code || ''} ${e.message}`);
    // EADDRINUSE：已有助手在跑，本实例退出即可
    if (e.code === 'EADDRINUSE') process.exit(0);
  });

  const listen = () =>
    server.listen(SOCK, () => {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(SOCK, 0o666);
        } catch {}
      }
      log(`listening on ${SOCK} uid=${typeof process.getuid === 'function' ? process.getuid() : 'n/a'}`);
    });

  // 若已有助手在运行（socket 可连），本实例直接退出，避免重复
  const probe = net.connect(SOCK);
  probe.on('connect', () => {
    probe.destroy();
    process.exit(0);
  });
  probe.on('error', () => {
    probe.destroy();
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(SOCK);
      } catch {}
    }
    listen();
  });
  probe.setTimeout(1500, () => {
    probe.destroy();
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(SOCK);
      } catch {}
    }
    listen();
  });
}

module.exports = { startServer, SOCK };
