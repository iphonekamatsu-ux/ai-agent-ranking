'use strict';

/**
 * Qiita（日本語・公式 API）
 * タグ指定で取得するため AI 関連への絞り込みは正確。
 *
 * API は新着順しか返さないため、期間内の記事をまとめて取得してから
 * LGTM 数で並べ替えている。認証なしでも 60 リクエスト/時 まで利用できる。
 */

const { httpGet, sleep } = require('../lib');

const KEY = 'qiita';
const LABEL = 'Qiita（日本語）';

async function collect(sourceCfg) {
  const tags = sourceCfg.tags || ['AI'];
  const limit = sourceCfg.limit ?? 20;
  const lookbackDays = sourceCfg.lookbackDays ?? 8;
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const sinceStr = since.toISOString().slice(0, 10);

  const items = new Map();

  for (const tag of tags) {
    const query = `tag:${tag} created:>${sinceStr}`;
    const url = `https://qiita.com/api/v2/items?query=${encodeURIComponent(query)}&per_page=100`;
    const json = await httpGet(url);
    for (const a of json || []) {
      const id = `qiita:${a.id}`;
      if (items.has(id)) continue;
      items.set(id, {
        id,
        source: KEY,
        title: a.title || '(タイトルなし)',
        url: a.url,
        score: a.likes_count ?? 0,
        scoreUnit: 'LGTM',
        createdAt: a.created_at || null,
        author: a.user?.id || '',
        matchedTag: tag,
      });
    }
    await sleep(1000);
  }

  const sorted = [...items.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  return { items: sorted, note: `タグ: ${tags.join(', ')}` };
}

module.exports = { KEY, LABEL, collect };
