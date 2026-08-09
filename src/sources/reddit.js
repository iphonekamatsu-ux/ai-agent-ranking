'use strict';

/**
 * Reddit（要 OAuth 認証・利用自体は無料）
 *
 * Reddit は認証なしのアクセスを拒否する（実測で 403 / RSS も 500）ため、
 * アプリ登録で得た ID とシークレットが必要になる。
 * 環境変数 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET が無い場合はスキップする。
 *
 * 登録手順は README を参照。無料・クレジットカード不要。
 */

const { httpGet, sleep, USER_AGENT } = require('../lib');

const KEY = 'reddit';
const LABEL = 'Reddit';

async function getAccessToken(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': USER_AGENT,
  };

  // アプリ種別によって使える許可方式が違うため、順に試す
  const grants = [
    'grant_type=client_credentials',
    'grant_type=https%3A%2F%2Foauth.reddit.com%2Fgrants%2Finstalled_client&device_id=DO_NOT_TRACK_THIS_DEVICE',
  ];

  let lastError = '';
  for (const body of grants) {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers,
      body,
    });
    if (res.ok) {
      const json = await res.json();
      if (json.access_token) return json.access_token;
      lastError = JSON.stringify(json).slice(0, 120);
    } else {
      lastError = `HTTP ${res.status}`;
    }
  }
  throw new Error(`アクセストークンを取得できませんでした（${lastError}）`);
}

async function collect(sourceCfg, aiPattern) {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return {
      items: [],
      skipped: true,
      note: 'REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET が未設定のためスキップしました（README の手順を参照）',
    };
  }

  const subreddits = sourceCfg.subreddits || ['LocalLLaMA'];
  const period = sourceCfg.period || 'week';
  const limit = sourceCfg.limit ?? 25;
  const minScore = sourceCfg.minScore ?? 0;

  const token = await getAccessToken(clientId, clientSecret);
  const items = new Map();
  let rejected = 0;

  for (const sub of subreddits) {
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(sub)}/top?t=${period}&limit=${limit}`;
    const json = await httpGet(url, { headers: { Authorization: `bearer ${token}` } });

    for (const child of json.data?.children || []) {
      const d = child.data;
      if (!d || d.stickied) continue;
      if ((d.score ?? 0) < minScore) continue;
      // AI 系サブレディットが中心なので通常は絞り込み不要。設定で有効化できる。
      if (aiPattern && sourceCfg.applyAiFilter && !aiPattern.test(d.title || '')) {
        rejected++;
        continue;
      }
      const id = `reddit:${d.id}`;
      if (items.has(id)) continue;
      items.set(id, {
        id,
        source: KEY,
        title: d.title || '(タイトルなし)',
        url: d.url_overridden_by_dest || `https://www.reddit.com${d.permalink}`,
        discussionUrl: `https://www.reddit.com${d.permalink}`,
        score: d.score ?? 0,
        scoreUnit: 'pt',
        comments: d.num_comments ?? 0,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
        subreddit: d.subreddit || sub,
      });
    }
    await sleep(1200);
  }

  return {
    items: [...items.values()],
    note: `r/${subreddits.join(', r/')}${rejected ? ` / 絞り込みで除外 ${rejected} 件` : ''}`,
  };
}

module.exports = { KEY, LABEL, collect };
