# Security Gate D — 運用上の Posture

[English](../../security/SECURITY_GATE_D.md)

## 強制される特性

- 既存のセキュリティメタデータが起動時に暗黙に書き換えられることはありません。
- Tier の Downgrade、Upgrade、Posture の置換、Restore 時の Rotation には、現在の Epoch/Tier を厳密に確認する明示的な運用者コマンドが必要です。
- メンテナンスモードは、Workspace の作成および開始、Agent Task、Approval の要求および承認、Git Operation の開始、認証情報の発行および使用をブロックします。Stop、Destroy、Read の操作は引き続き利用できます。
- マイグレーションは現在のメタデータをロックし、Git Operation が `PUSHING` の場合は中断します。
- Pending/Approved の Approval は Stale になります。未完了の Operation はキャンセルされ、Reserved/Issued の Lease は無効化され、Active な Workspace は停止されます。
- セキュリティ Epoch は増加のみ可能で、Commit 前に JavaScript の安全な整数範囲を超えないか確認されます。
- 構造化監査行は追記専用で、シークレットを示すキーを詳細情報に含めることを拒否します。
- Outbox Payload は Desired State の意図だけを受け入れ、シークレットを含めることはできません。

## 自動チェック

`npm run check` は、起動時の Downgrade/Posture の拒否、メンテナンス時のフェイルクローズ動作、明示的な確認、マイグレーション成功時および失敗時の状態、シークレットを含まない監査および Outbox スキーマ、上限付き Outbox 再試行、配信前の永続化順序、読み取り専用のステータスおよび監査 API を検証します。

通常のコンテナ CI では、マイグレーションを含む Control イメージもビルドし、Validator、Codex ID、Git CAS の各境界を再検証します。

## デプロイゲート

Gate D を満たすと判断する前に、PostgreSQL をバックアップし、マイグレーション 007 から 010 を適用し、使い捨てのデプロイ環境で Epoch だけの Rotation をリハーサルしてください。古い Approval がその後承認も使用もできないこと、Active な Workspace が `STOPPED` に収束すること、IDE Code/Session が無効になること、監査イベントが存在すること、サービスがメンテナンスモードを終了することを確認してください。

データベースを Restore した後は毎回、サービスを再開する前に Epoch だけの Rotation を実行してください。古い Approval をそのまま提供し始める Restore は、Gate D を満たしません。
