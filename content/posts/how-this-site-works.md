---
title: "How this site works"
date: 2026-09-11
summary: "Markdown in a repo, built by Hugo, served by Cloudflare. Here is the whole thing, so future-me remembers how to change it."
tags: ["meta"]
draft: false
---

Every page here is a markdown file in a GitHub repository. Committing to `main`
triggers a build, and the built site is live within a minute or so. There is no
database, no login, and nothing to patch.

## Writing a post

Add a file under `content/posts/`. The filename becomes the URL, so
`content/posts/my-thing.md` publishes at `/posts/my-thing/`. The top of the
file is front matter:

```yaml
---
title: "How this site works"
date: 2026-09-11
summary: "One sentence shown on the list page and used as the description."
tags: ["meta"]
draft: false
---
```

Set `draft: true` and it stays out of the build until you flip it. That is the
staging mechanism — no separate branch needed for a rough draft.

## What the front matter does

| Field | Effect |
| --- | --- |
| `title` | Page heading, browser tab, link previews |
| `date` | Sort order and the date shown; back-date freely |
| `summary` | Standfirst on the page, blurb on the list, meta description |
| `tags` | Optional; builds a tag page automatically |
| `draft` | `true` keeps it out of the build entirely |
| `sources` | Optional list of `{title, url}`, rendered as a Sources block |

## Sources

When a post leans on outside material, cite it rather than asserting. The
`sources` field takes a list:

```yaml
sources:
  - title: "Cloudflare Pages limits"
    url: "https://developers.cloudflare.com/pages/platform/limits/"
```

## Editing

Three ways, all equivalent as far as the site is concerned:

- **GitHub web** — open the file, pencil icon, commit. Fine for a typo.
- **github.dev** — press `.` on any repo page for a full editor in the browser.
- **Ask Claude** — draft or revise here and push the commit.

## What it costs

Nothing, at this size. Cloudflare Pages serves static assets with unmetered
bandwidth on the free plan, with a 500-build-per-month ceiling. A domain is the
only real cost.

## What is deliberately missing

No analytics, no comments, no fonts loaded from someone else's server, no
JavaScript at all. Every one of those is a request to a third party on behalf
of whoever is reading, and none of them make the writing better.
