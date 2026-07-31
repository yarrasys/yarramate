// Test-the-tests fixture, NOT an arm artifact and never handed to any
// agent: a minimal in-memory server implementing just enough of Conduit
// plus the full spec delta to prove the delta-hurl suites are runnable and
// the conformance runner works. Pre-registered acceptance tests that are
// themselves broken would burn a paid run; this stub is how we know they
// are not. It deliberately does NOT implement the full upstream suite.
//
//   PORT=3199 node reference-stub.mjs

import { createServer } from 'node:http';

const users = new Map();          // token -> { username, email }
const articles = new Map();       // slug -> { title, description, body, author, favoritedBy:Set, revisions: [] }
const audits = new Map();         // username -> [{ action, resourceType, resourceId, createdAt }]
const mutationTimes = new Map();  // username -> [epoch-ms]

const json = (res, status, payload) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};
const unauthorized = (res) => json(res, 401, { errors: { body: ['unauthorized'] } });
const slugify = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const audit = (username, action, resourceType, resourceId) => {
  const list = audits.get(username) ?? [];
  list.unshift({ action, resourceType, resourceId, createdAt: new Date().toISOString() });
  audits.set(username, list);
};

const rateLimited = (username) => {
  const now = Date.now();
  const recent = (mutationTimes.get(username) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 60) {
    mutationTimes.set(username, recent);
    return true;
  }
  recent.push(now);
  mutationTimes.set(username, recent);
  return false;
};

const articleView = (slug) => {
  const article = articles.get(slug);
  return {
    slug, title: article.title, description: article.description, body: article.body,
    tagList: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    favorited: false, favoritesCount: article.favoritedBy.size,
    author: { username: article.author, bio: null, image: null, following: false },
  };
};

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const token = (req.headers.authorization ?? '').replace(/^Token /, '');
    const user = users.get(token);

    if (req.method === 'POST' && path === '/api/users') {
      const { username, email } = body.user;
      users.set(username, { username, email });
      return json(res, 201, { user: { username, email, token: username, bio: null, image: null } });
    }
    if (req.method === 'GET' && path === '/api/tags') return json(res, 200, { tags: [] });

    const mutating = req.method !== 'GET';
    if (mutating) {
      if (!user) return unauthorized(res);
      if (rateLimited(user.username)) {
        return json(res, 429, { errors: { 'rate-limit': ['too many mutating requests'] } });
      }
    }

    if (req.method === 'POST' && path === '/api/articles') {
      const { title, description, body: articleBody } = body.article;
      const slug = slugify(title);
      articles.set(slug, { title, description, body: articleBody, author: user.username, favoritedBy: new Set(), revisions: [] });
      audit(user.username, 'create', 'article', slug);
      return json(res, 201, { article: articleView(slug) });
    }

    const articleMatch = path.match(/^\/api\/articles\/([^/]+)(\/.*)?$/);
    if (articleMatch && articles.has(articleMatch[1])) {
      const slug = articleMatch[1];
      const article = articles.get(slug);
      const rest = articleMatch[2] ?? '';
      if (req.method === 'PUT' && rest === '') {
        article.revisions.unshift({
          title: article.title, description: article.description, body: article.body,
          revisedAt: new Date().toISOString(),
        });
        const update = body.article;
        if (update.title !== undefined) article.title = update.title;
        if (update.description !== undefined) article.description = update.description;
        if (update.body !== undefined) article.body = update.body;
        audit(user.username, 'update', 'article', slug);
        return json(res, 200, { article: articleView(slug) });
      }
      if (req.method === 'POST' && rest === '/favorite') {
        article.favoritedBy.add(user.username);
        audit(user.username, 'favorite', 'article', slug);
        return json(res, 200, { article: articleView(slug) });
      }
      if (req.method === 'DELETE' && rest === '/favorite') {
        article.favoritedBy.delete(user.username);
        audit(user.username, 'unfavorite', 'article', slug);
        return json(res, 200, { article: articleView(slug) });
      }
      if (req.method === 'GET' && rest === '/revisions') {
        if (!user) return unauthorized(res);
        if (user.username !== article.author) return json(res, 403, { errors: { body: ['author only'] } });
        return json(res, 200, { revisions: article.revisions, revisionCount: article.revisions.length });
      }
      if (req.method === 'GET' && rest === '') return json(res, 200, { article: articleView(slug) });
    }

    if (req.method === 'GET' && path === '/api/audit') {
      if (!user) return unauthorized(res);
      const list = audits.get(user.username) ?? [];
      const limit = Number(url.searchParams.get('limit') ?? 20);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json(res, 200, { audit: list.slice(offset, offset + limit), auditCount: list.length });
    }

    return json(res, 404, { errors: { body: ['not found'] } });
  });
});

server.listen(Number(process.env.PORT ?? 3000), () => {
  console.log(`reference stub on :${process.env.PORT ?? 3000}`);
});
