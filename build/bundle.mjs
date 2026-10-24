import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const distDir = path.join(root, 'dist', 'renderer');
const previewDir = path.join(root, 'preview');
const args = new Set(process.argv.slice(2));
const wantPreview = args.has('--preview') || args.has('--watch');
const watch = args.has('--watch');

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(previewDir, { recursive: true });

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/renderer/main.tsx')],
  bundle: true,
  format: 'iife',
  // chrome76 = Electron 6 的内核版本，锁定它才能向下兼容 macOS 10.10 的老构建
  target: ['chrome76'],
  jsx: 'automatic',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  outfile: path.join(distDir, 'app.js'),
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'info',
};

function copyHtml() {
  const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
  fs.writeFileSync(path.join(distDir, 'index.html'), html);
}

function buildPreview() {
  const js = fs.readFileSync(path.join(distDir, 'app.js'), 'utf8');
  const cssPath = path.join(distDir, 'app.css');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Diter · 界面预览</title>
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<script>window.__DITER_MOCK__ = true;</script>
<script>${js}</script>
</body>
</html>`;
  const out = path.join(previewDir, 'diter-preview.html');
  fs.writeFileSync(out, html);
  console.log(`preview → ${path.relative(root, out)}  (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
}

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'post',
        setup(build) {
          build.onEnd((res) => {
            if (res.errors.length) return;
            copyHtml();
            buildPreview();
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
  copyHtml();
  if (wantPreview) buildPreview();
  console.log('build ok → dist/renderer');
}
