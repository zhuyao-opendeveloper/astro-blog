---
title: '在 GitHub Pages 上部署 Astro 博客'
description: '从零把 Astro 博客部署到 GitHub Pages，并配置自动部署工作流。'
pubDate: '2026-09-12'
heroImage: '../../assets/blog-placeholder-3.jpg'
tags: ['Astro', 'GitHub Pages', '部署']
---

折腾了一圈，终于把这个 Astro 博客部署到了 GitHub Pages。这里记录一下完整流程和几个容易踩的坑。

## 1. 创建项目

使用官方脚手架，选择 `blog` 模板：

```bash
npm create astro@latest my-blog -- --template blog
```

## 2. 配置 base 路径

GitHub Pages 的项目站点会带一个子路径（例如 `/astro-blog`），必须在 `astro.config.mjs` 里声明 `base`，否则资源（CSS、图片）会 404：

```js
export default defineConfig({
  site: 'https://zhuyao-opendeveloper.github.io',
  base: '/astro-blog',
  integrations: [mdx(), sitemap()],
});
```

## 3. 添加部署工作流

在 `.github/workflows/deploy.yml` 写入官方 Pages 部署流程：push 到 `main` 时自动安装依赖、构建并发布到 `gh-pages` 环境。

## 4. 启用 Pages 源

仓库创建后需要把 Pages 的构建源设为 **GitHub Actions**。可以通过仓库设置页面开启，也可以用 API：

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"build_type":"workflow","source":{"branch":"main","path":"/"}}' \
  https://api.github.com/repos/<owner>/<repo>/pages
```

## 踩坑提示

- `actions/setup-node` 的 `cache: npm` 需要 `package-lock.json`；没有的话会直接让「Set up Node」失败。要么提交 lockfile 用 `npm ci`，要么去掉 cache 用 `npm install`。
- 本地 `npm install` 很慢时，干脆不本地装，让 CI 在云端的高速网络上构建。
- 推送代码时如果遇到凭据交互弹窗，把 token 临时拼进远程 URL 即可：`git push https://$TOKEN@github.com/<owner>/<repo>.git main`（用完记得把远程地址还原成干净的 URL，别把 token 落进 `.git/config`）。

完成后，每次 push 到 `main`，站点都会在几分钟内自动更新。
