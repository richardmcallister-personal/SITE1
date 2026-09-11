# Site

Hugo. Markdown in, static HTML out. No JavaScript, no external requests, no
third-party anything.

```
hugo.toml              site config — title, menu, intro copy, contact links
content/posts/*.md     one file per post
content/about.md       the About page
layouts/               templates (hand-written, no theme dependency)
static/                style.css, _headers — copied to the site root verbatim
archetypes/default.md  front matter template for `hugo new`
public/                build output — gitignored, never edit
```

## Writing

Add a file under `content/posts/`. Filename becomes the URL.

```yaml
---
title: "Post title"
date: 2026-09-11
summary: "One sentence — standfirst, list blurb, and meta description."
tags: ["method"]
draft: true
sources:
  - title: "Source name"
    url: "https://example.com"
---
```

`draft: true` keeps it out of the build. Flip to `false` to publish.

Three ways to edit, all the same to the site: GitHub's web editor (pencil
icon), github.dev (press `.` on any repo page), or ask Claude to draft and
commit.

## Local preview

Hugo is a single binary, no package manager involved.

```bash
hugo server -D     # -D includes drafts; http://localhost:1313
hugo --gc --minify # production build into public/
```

## Deploying on Cloudflare Pages

Workers & Pages → Create → Pages → Connect to Git → pick this repo.

| Setting | Value |
| --- | --- |
| Framework preset | Hugo |
| Build command | `hugo --gc --minify` |
| Build output directory | `public` |
| Environment variable | `HUGO_VERSION` = `0.140.2` |

Pin `HUGO_VERSION`. Without it Pages picks its own default, and a version drift
six months from now will break a build you did not touch.

Custom domain: Pages project → Custom domains. TLS is automatic.

## Before the domain goes live

- [ ] Set `baseURL` in `hugo.toml` to the real domain — RSS and canonical
      URLs are wrong until you do
- [ ] Fill in `params.email` and `params.linkedin`, or the footer links vanish
- [ ] Rewrite `content/about.md`
- [ ] Decide whether `params.disclaimer` ("Views my own.") should stay

## Notes

- `static/_headers` sets CSP, HSTS and frame options. CSP is `script-src 'none'`
  because the site runs no JavaScript. If you ever add some, that line has to
  change or it will be blocked.
- Tag pages build automatically from the `tags` front matter; there is no tag
  index in the nav by design.
- RSS is at `/index.xml`.
