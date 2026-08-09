'use strict';

/**
 * Hugging Face（公式 API・認証不要）
 * トレンドのモデルと、日替わり注目論文を取得する。
 * 掲載されているものは全て AI 関連なので、キーワードによる絞り込みは不要。
 */

const { httpGet, sleep } = require('../lib');

const KEY = 'huggingface';
const LABEL = 'Hugging Face';

async function collect(sourceCfg) {
  const limit = sourceCfg.limit ?? 30;
  const items = [];
  const notes = [];

  // トレンドモデル
  try {
    const models = await httpGet(
      `https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=${limit}`
    );
    for (const m of models || []) {
      items.push({
        id: `hf-model:${m.id}`,
        source: KEY,
        kind: 'model',
        title: m.id,
        url: `https://huggingface.co/${m.id}`,
        score: m.likes ?? 0,
        scoreUnit: 'like',
        downloads: m.downloads ?? 0,
        createdAt: m.createdAt || null,
        pipeline: m.pipeline_tag || '',
      });
    }
  } catch (err) {
    notes.push(`モデル取得に失敗: ${err.message}`);
  }

  await sleep(300);

  // 注目論文（daily papers）
  try {
    const papers = await httpGet(`https://huggingface.co/api/daily_papers?limit=${limit}`);
    for (const p of papers || []) {
      const paperId = p.paper?.id || p.id;
      if (!paperId) continue;
      items.push({
        id: `hf-paper:${paperId}`,
        source: KEY,
        kind: 'paper',
        title: p.title || p.paper?.title || '(タイトルなし)',
        url: `https://huggingface.co/papers/${paperId}`,
        score: p.paper?.upvotes ?? 0,
        scoreUnit: 'up',
        createdAt: p.publishedAt || null,
      });
    }
  } catch (err) {
    notes.push(`論文取得に失敗: ${err.message}`);
  }

  return { items, note: notes.join(' / ') };
}

module.exports = { KEY, LABEL, collect };
