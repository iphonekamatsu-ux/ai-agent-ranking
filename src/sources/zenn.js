'use strict';

/**
 * Zenn（日本語）
 * トピック指定で取得するため AI 関連への絞り込みは正確。
 *
 * 注意: 使用しているのは Zenn が公開している内部 API で、公式に文書化されたものではない。
 * 仕様変更で動かなくなる可能性があるため、失敗しても全体は止めない設計にしている。
 */

const { httpGet, sleep } = require('../lib');

const KEY = 'zenn';
const LABEL = 'Zenn（日本語）';

async function collect(sourceCfg) {
  const topics = sourceCfg.topics || ['ai'];
  const limit = sourceCfg.limit ?? 20;
  const items = new Map();

  for (const topic of topics) {
    const url = `https://zenn.dev/api/articles?topicname=${encodeURIComponent(topic)}&order=daily&count=${limit}`;
    const json = await httpGet(url);
    for (const a of json.articles || []) {
      const id = `zenn:${a.id}`;
      if (items.has(id)) continue;
      items.set(id, {
        id,
        source: KEY,
        title: a.title || '(タイトルなし)',
        url: `https://zenn.dev${a.path}`,
        score: a.liked_count ?? 0,
        scoreUnit: '♥',
        createdAt: a.published_at || null,
        author: a.user?.username || '',
        matchedTopic: topic,
      });
    }
    await sleep(500);
  }

  return { items: [...items.values()], note: `トピック: ${topics.join(', ')}` };
}

module.exports = { KEY, LABEL, collect };
