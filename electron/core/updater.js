'use strict';
/**
 * 检查更新 / 下载安装（仅主进程使用）。
 * 流程：GitHub Releases API 查最新版 → 比较版本 → 匹配当前平台资产 → 下载 → 安装。
 */
const { app, shell } = require('electron');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const REPO = 'nocrashtodaytech/Diter';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/* ----------------------------- 工具 ----------------------------- */

function parseVersion(tag) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(tag || ''));
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function versionStr(v) {
  return v ? v.join('.') : '';
}

/** a > b 返回正数，a < b 返回负数，相等返回 0 */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** 简单 GET，返回 JSON 对象（自动跟随重定向，限时 15s） */
function apiGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(
      url,
      { headers: { 'User-Agent': 'Diter-Updater', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          resolve(apiGet(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`请求失败 HTTP ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('响应解析失败'));
          }
        });
      }
    );
    req.on('error', () => reject(new Error('网络请求失败')));
    req.setTimeout(15000, () => req.destroy(new Error('请求超时')));
  });
}

/** 匹配当前平台/架构的安装包资产 */
function pickAsset(assets, platform, arch) {
  if (!Array.isArray(assets) || !assets.length) return null;
  const names = assets.map((a) => a.name);

  if (platform === 'darwin') {
    const dmgs = assets.filter((a) => /\.dmg$/i.test(a.name));
    if (!dmgs.length) return null;
    if (arch === 'arm64') {
      return dmgs.find((a) => /arm64|aarch64/i.test(a.name)) || null;
    }
    return dmgs.find((a) => /x64|x86_64|amd64/i.test(a.name) && !/arm64/i.test(a.name)) || dmgs[0];
  }

  if (platform === 'win32') {
    const exe = assets.find((a) => /\.exe$/i.test(a.name) && !/\.blockmap$/i.test(a.name));
    if (exe) return exe;
    const zip = assets.find((a) => /\.zip$/i.test(a.name) && !/\.blockmap$/i.test(a.name));
    return zip || null;
  }

  // Linux：AppImage 优先，其次 deb
  return (
    assets.find((a) => /\.AppImage$/i.test(a.name)) ||
    assets.find((a) => /\.deb$/i.test(a.name)) ||
    null
  );
}

/* ----------------------------- 检查更新 ----------------------------- */

async function check() {
  const current = parseVersion(app.getVersion());
  const rel = await apiGet(RELEASES_API);
  const latest = parseVersion(rel.tag_name);
  const asset = pickAsset(rel.assets, process.platform, process.arch);
  const hasUpdate = !!current && !!latest && compareVersions(latest, current) > 0;

  return {
    ok: true,
    hasUpdate,
    current: versionStr(current),
    latest: versionStr(latest),
    tagName: rel.tag_name,
    notes: rel.body || '',
    htmlUrl: rel.html_url || RELEASES_PAGE,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
  };
}

/* ----------------------------- 下载 ----------------------------- */

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const doReq = (u, redirects) => {
      const mod = u.startsWith('https') ? https : http;
      const req = mod.get(u, { headers: { 'User-Agent': 'Diter-Updater' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects > 5) return reject(new Error('重定向次数过多'));
          return doReq(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress({ received, total, pct: total > 0 ? received / total : 0 });
        });
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve(dest)));
        out.on('error', reject);
      });
      req.on('error', reject);
    };
    doReq(url, 0);
  });
}

/* ----------------------------- 安装 ----------------------------- */

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeout || 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim().slice(0, 300) || '命令执行失败'));
      else resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

async function installMac(dmgPath) {
  // 1) 挂载 dmg
  const { stdout } = await run('hdiutil', ['attach', dmgPath, '-nobrowse', '-noautoopen', '-readonly']);
  // 输出形如：/dev/disk2  ...  /Volumes/Diter
  const mount = stdout
    .split('\n')
    .map((l) => /\/Volumes\/.+/.exec(l))
    .filter(Boolean)
    .map((m) => m[0].trim())
    .pop();
  if (!mount) throw new Error('挂载更新镜像失败');

  try {
    const appSrc = path.join(mount, 'Diter.app');
    if (!fs.existsSync(appSrc)) throw new Error('更新镜像中未找到 Diter.app');

    const target = '/Applications/Diter.app';
    const escapedSrc = appSrc.replace(/"/g, '\\"');

    // 2) 复制到 /Applications（覆盖旧版）；/Applications 需要管理员权限，用 osascript 提权
    await new Promise((resolve, reject) => {
      const script =
        `do shell script "rm -rf '/Applications/Diter.app' && /usr/bin/ditto '${escapedSrc}' '/Applications/Diter.app'" with administrator privileges`;
      execFile('osascript', ['-e', script], { timeout: 180000 }, (err, _so, se) => {
        if (err) reject(new Error((se || err.message || '').trim().slice(0, 300) || '安装被取消或失败'));
        else resolve();
      });
    });

    // 3) 卸载镜像
    try {
      await run('hdiutil', ['detach', mount, '-force']);
    } catch {}

    return { mode: 'restart', message: '已安装到 /Applications' };
  } catch (e) {
    try {
      await run('hdiutil', ['detach', mount, '-force']);
    } catch {}
    throw e;
  }
}

async function installWindows(filePath, assetName) {
  if (/\.exe$/i.test(assetName)) {
    // NSIS 安装器：直接运行
    const { spawn } = require('child_process');
    const child = spawn(filePath, [], { detached: true, stdio: 'ignore' });
    child.unref();
    return { mode: 'quit', message: '已启动安装程序' };
  }

  // 绿色版 zip：解压到 %LOCALAPPDATA%\Programs\Diter，再运行 Diter.exe
  const dest = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Diter');
  fs.mkdirSync(dest, { recursive: true });
  await run('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path '${filePath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
  ]);
  const exe = path.join(dest, 'Diter.exe');
  if (!fs.existsSync(exe)) throw new Error('解压后未找到 Diter.exe');
  const { spawn } = require('child_process');
  const child = spawn(exe, [], { detached: true, stdio: 'ignore' });
  child.unref();
  return { mode: 'quit', message: '已更新并启动' };
}

async function install(filePath, assetName) {
  if (process.platform === 'darwin') return installMac(filePath);
  if (process.platform === 'win32') return installWindows(filePath, assetName);
  shell.showItemInFolder(filePath);
  return { mode: 'manual', message: '已下载，请手动安装' };
}

/* ----------------------------- 入口 ----------------------------- */

/** 下载到临时目录并安装。onProgress({phase,pct,received,total}) */
async function downloadAndInstall(asset, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diter-update-'));
  const dest = path.join(tmpDir, asset.name);
  try {
    onProgress({ phase: 'downloading', pct: 0, received: 0, total: asset.size || 0 });
    await download(asset.url, dest, (p) =>
      onProgress({ phase: 'downloading', pct: p.pct, received: p.received, total: p.total })
    );
    onProgress({ phase: 'installing', pct: 1, received: asset.size || 0, total: asset.size || 0 });
    const r = await install(dest, asset.name);
    return r;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { check, downloadAndInstall, pickAsset };
