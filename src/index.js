'use strict';

/** 取得 → レポート生成 をまとめて実行する。通常はこれを呼べばよい。 */

const fetchStep = require('./fetch');
const reportStep = require('./report');

(async () => {
  try {
    await fetchStep.main();
    console.log('');
    reportStep.main();
  } catch (err) {
    console.error(`\nエラー: ${err.message}`);
    process.exit(1);
  }
})();
