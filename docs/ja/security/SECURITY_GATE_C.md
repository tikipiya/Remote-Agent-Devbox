# Security Gate C — 制御された Git 書き込み

[English](../../security/SECURITY_GATE_C.md)

## 強制される特性

- 承認は、イミュータブルなレビューダイジェスト、厳密な Validator プロファイル、セキュリティ Epoch、Tier、Posture に結び付けられ、有効期間に上限があります。
- 承認の決定と Git Operation の作成では、Row Lock を使用するデータベーストランザクション内で、それぞれのバインディングを再確認します。
- 最終再検証では、元のイミュータブルな成果物を、ネットワークなしで、承認済みの厳密な Validator プロファイルを使用して検証します。
- Push できるのは `agent/<workspace UUID>` だけです。Default Branch への直接書き込みは、リモートアクセスの前に拒否されます。
- リモートへの書き込みには、1つの明示的な Refspec と期待値を明示した `--force-with-lease` を使用します。無条件の Force Push は使用しません。
- GitHub App Token は1つの Repository と最小限の書き込み権限にスコープされます。Token のバイト列は永続化されず、コマンド引数にも配置されません。
- セキュリティ Epoch は、Lease の予約前、Token Issuer、認証情報の使用直前に確認されます。
- 認証情報の結果は `CONSUMED`、`FAILED`、`UNCERTAIN` のいずれかです。曖昧な結果を自動的に再試行することはありません。

## 自動チェック

`npm run check` は、承認の有効期限とコンテキストのバインディング、Protected Branch のブロック、厳密なレビューの再現、Token リクエストのスコープ、JWT の有効期間、Git 引数で認証情報が露出しないこと、Pull Request の冪等性、CAS の競合、Lease の結果を検証します。

`npm run verify:git-cas` は実際の Bare Git Remote を作成し、CAS の3つのケースをすべて証明します。存在しない場合だけ作成すること、観測した HEAD の場合だけ更新すること、古い期待 HEAD を拒否して Remote を変更しないことです。

## デプロイゲート

そのデプロイ環境が Gate C を満たすと判断する前に、運用者は GitHub App を設定およびインストールし、承認済みの End-to-End Git 書き込みを1回実行する必要があります。App の認証情報3項目がすべて揃うまで、Git Operation の作成は、Remote の観測やデータベースの変更より前に失敗します。

Gate C は、`rad-control`、Host、Docker Daemon、PostgreSQL 管理、GitHub App Private Key ストレージの侵害から保護されるとは主張しません。これらは引き続き Tier 1 の信頼境界内にあります。
