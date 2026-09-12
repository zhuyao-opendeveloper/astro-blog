#!/usr/bin/env node
/**
 * 本地发文后台（纯 Node 标准库，无需 npm install）
 *
 * 启动：  node scripts/publish-server.mjs
 * 打开：  http://127.0.0.1:5178
 *
 * 功能：
 *   1. 在网页表单填写标题/别名/日期/标签/封面/正文
 *   2. 自动生成 src/content/blog/<slug>.md（带 frontmatter）
 *   3. 本地 git commit
 *   4. 若填写了 GitHub Token，则一键 push 触发 GitHub Pages 自动部署
 *
 * 安全说明：
 *   - Token 仅用于本次 push 的内存操作，绝不写入任何文件或 .git/config
 *   - 用完建议到 github.com/settings/tokens 回收该 token
 *   - 仅在本地（127.0.0.1）监听，不对外暴露
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import querystring from 'node:querystring';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');
const PORT = 5178;
const REPO_OWNER = 'zhuyao-opendeveloper';
const REPO_NAME = 'astro-blog';
const SITE_URL = 'https://zhuyao-opendeveloper.github.io/astro-blog/';

function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// 清掉本机失效代理变量，保证 git 直连
function cleanEnv() {
  const e = { ...process.env };
  ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'ALL_PROXY'].forEach(
    (k) => delete e[k],
  );
  e.no_proxy = '*';
  return e;
}

function slugFromAlias(alias) {
  let s = (alias || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    s = `post-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
      d.getMinutes(),
    )}${p(d.getSeconds())}`;
  }
  return s;
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait */
  }
}

const FORM = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zhuyao 博客 · 发文后台</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  h1 { font-size: 1.4rem; }
  label { display: block; margin: .9rem 0 .3rem; font-weight: 600; }
  input, select, textarea { width: 100%; padding: .55rem .7rem; border: 1px solid #ccc; border-radius: 8px; font: inherit; background: var(--bg, #fff); color: inherit; }
  textarea { min-height: 240px; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  .row { display: flex; gap: 1rem; }
  .row > div { flex: 1; }
  .hint { font-size: .8rem; opacity: .65; margin-top: .2rem; }
  button { margin-top: 1.2rem; padding: .7rem 1.4rem; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 1rem; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .token { border-color: #e0a800; }
</style>
</head>
<body>
  <h1>📝 Zhuyao 博客 · 发文后台</h1>
  <p class="hint">填写后点击「生成并发布」。不填 Token 则只保存到本地并提交 git，之后可手动推送。</p>
  <form method="post" action="/publish">
    <label for="title">标题 *</label>
    <input id="title" name="title" required placeholder="例如：用 Astro 搭建个人博客" />

    <div class="row">
      <div>
        <label for="alias">URL 别名（英文，选填）</label>
        <input id="alias" name="alias" placeholder="留空则自动生成 post-时间戳" />
      </div>
      <div>
        <label for="date">发布日期</label>
        <input id="date" name="date" type="date" />
      </div>
    </div>

    <label for="tags">标签（逗号分隔）</label>
    <input id="tags" name="tags" placeholder="Astro, 部署, 前端" />

    <label for="hero">封面图</label>
    <select id="hero" name="hero">
      <option value="none">无</option>
      <option value="1">占位图 1</option>
      <option value="2">占位图 2</option>
      <option value="3" selected>占位图 3</option>
      <option value="4">占位图 4</option>
      <option value="5">占位图 5</option>
    </select>

    <label for="content">正文（Markdown）</label>
    <textarea id="content" name="content" placeholder="在这里用 Markdown 写正文…"></textarea>

    <label for="token">GitHub Token（选填，仅本次发布用，不保存）</label>
    <input id="token" name="token" class="token" type="password" placeholder="ghp_xxx 或 fine-grained token" />
    <div class="hint">需要 repo 权限。发布完建议到 github.com/settings/tokens 回收。</div>

    <button type="submit">生成并发布</button>
  </form>
</body>
</html>`;

function handlePublish(form) {
  const title = (form.title || '').trim();
  if (!title) {
    return page('出错了', '<p>标题不能为空。</p><p><a href="/">返回重新填写</a></p>', false);
  }

  const alias = (form.alias || '').trim();
  const slug = slugFromAlias(alias);
  const date = (form.date || '').trim() || new Date().toISOString().slice(0, 10);

  const tags = (form.tags || '')
    .split(/[,\n，]/)
    .map((t) => t.trim())
    .filter(Boolean);

  const heroRaw = (form.hero || 'none').trim();
  const hero =
    heroRaw && heroRaw !== 'none' ? `../../assets/blog-placeholder-${heroRaw}.jpg` : '';

  const content = (form.content || '').replace(/\r\n/g, '\n').trim();
  const firstLine = content.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '（无简介）';
  const description = firstLine.length > 100 ? firstLine.slice(0, 100) : firstLine;

  const fm = ['---', `title: '${title.replace(/'/g, "\\'")}'`, `description: '${description.replace(/'/g, "\\'")}'`, `pubDate: '${date}'`];
  if (hero) fm.push(`heroImage: '${hero}'`);
  if (tags.length) {
    fm.push(`tags: [${tags.map((t) => `'${t.replace(/'/g, "\\'")}'`).join(', ')}]`);
  }
  fm.push('---');

  const md = `${fm.join('\n')}\n\n${content}\n`;

  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    return page(
      '出错了',
      `<p>文件已存在：<code>${esc(`${slug}.md`)}</code>，请换一个别名或删除旧文件。</p><p><a href="/">返回</a></p>`,
      false,
    );
  }

  try {
    fs.mkdirSync(BLOG_DIR, { recursive: true });
    fs.writeFileSync(filePath, md, 'utf8');
  } catch (e) {
    return page('写入失败', `<p>${esc(String(e.message))}</p>`, false);
  }

  // 本地提交
  let commitOk = false;
  let commitMsg = '';
  try {
    const env = cleanEnv();
    execSync(`git add "${filePath}"`, { cwd: ROOT, env, stdio: 'pipe' });
    execSync(
      `git -c user.email="zhuyao@users.noreply.github.com" -c user.name="zhuyao" commit -q -m "post: ${title}"`,
      { cwd: ROOT, env, stdio: 'pipe' },
    );
    commitOk = true;
  } catch (e) {
    commitMsg = esc(String(e.stdout || e.stderr || e.message).slice(0, 400));
  }

  // 可选推送
  let pushResult = null;
  const token = (form.token || '').trim();
  if (token) {
    const remote = `https://${token}@github.com/${REPO_OWNER}/${REPO_NAME}.git`;
    for (let i = 1; i <= 15; i++) {
      try {
        execSync(`git push "${remote}" main`, { cwd: ROOT, env: cleanEnv(), stdio: 'pipe', timeout: 60000 });
        pushResult = { ok: true, attempt: i };
        break;
      } catch (e) {
        if (i === 15) {
          pushResult = { ok: false, err: esc(String(e.stdout || e.stderr || e.message).slice(0, 300)) };
        } else {
          sleepSync(4000);
        }
      }
    }
  }

  // 还原远程地址（若之前被 workflow 改动，保持干净；此处主要是防御）
  try {
    execSync(`git remote set-url origin https://github.com/${REPO_OWNER}/${REPO_NAME}.git`, {
      cwd: ROOT,
      env: cleanEnv(),
      stdio: 'pipe',
    });
  } catch {
    /* ignore */
  }

  const body = [];
  body.push(`<p>✅ 文章已生成：<code>${esc(`${slug}.md`)}</code></p>`);
  body.push(
    `<ul><li>标题：${esc(title)}</li><li>日期：${esc(date)}</li>${
      tags.length ? `<li>标签：${esc(tags.join(', '))}</li>` : ''
    }${hero ? `<li>封面：${esc(hero)}</li>` : ''}</ul>`,
  );
  if (commitOk) {
    body.push('<p>✅ 已本地提交（git commit）。</p>');
  } else {
    body.push(`<p>⚠️ 本地提交未成功（可能无变更或 git 未配置）：<br><code>${commitMsg}</code></p>`);
  }
  if (token && pushResult) {
    if (pushResult.ok) {
      body.push(
        `<p>🚀 已推送到 GitHub，GitHub Actions 会自动部署。稍候访问：<a href="${SITE_URL}" target="_blank">${esc(
          SITE_URL,
        )}</a></p>`,
      );
    } else {
      body.push(`<p>⚠️ 推送失败：${pushResult.err}</p>`);
    }
  } else {
    body.push(
      `<p>ℹ️ 未填写 Token，文章已保存在本地并已提交。需要上线请运行：</p><pre><code>git push origin main</code></pre>`,
    );
  }
  body.push('<p><a href="/">再写一篇</a></p>');

  return page('发布完成', body.join('\n'), true);
}

function page(title, bodyHtml, ok) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · 发文后台</title>
<style>body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7}code{background:#f0f0f0;padding:.1em .4em;border-radius:4px}pre{background:#f6f6f6;padding:1rem;border-radius:8px;overflow:auto}a{color:#2563eb}</style>
</head>
<body>
<h1>${ok ? '✅' : '⚠️'} ${esc(title)}</h1>
${bodyHtml}
</body></html>`;
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(FORM);
    return;
  }
  if (req.method === 'POST' && req.url === '/publish') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 5e6) req.destroy();
    });
    req.on('end', () => {
      let form = {};
      try {
        form = querystring.parse(body);
      } catch {
        /* ignore */
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(handlePublish(form));
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`发文后台已启动: http://127.0.0.1:${PORT}`);
});
