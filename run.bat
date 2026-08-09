@echo off
rem このファイルをダブルクリックすると、取得とレポート生成がまとめて実行されます。
cd /d "%~dp0"
rem 社内ネットワークの証明書検査に対応するため、Windows の証明書ストアを使う
set NODE_OPTIONS=--use-system-ca
node src\index.js
echo.
echo ---------------------------------------------
echo 完了しました。reports\latest.md を開いてください。
echo ---------------------------------------------
pause
