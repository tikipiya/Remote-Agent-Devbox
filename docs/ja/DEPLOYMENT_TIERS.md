# デプロイ Tier

[English](../DEPLOYMENT_TIERS.md)

## 実装済みの Tier

このリリースでは Tier 1（Secure Personal / Small Team）を実装しています。Host、PostgreSQL 管理者、Docker Daemon、`rad-control` プロセスを信頼します。`rad-control` 内部のモジュール境界は監査可能性を向上させますが、プロセス分離境界ではありません。

Tier の値は最低限のセキュリティ契約であり、機能の Toggle ではありません。現在のバイナリが受け入れるのは Tier 1 の設定だけです。Tier 2 と Tier 3 にはこのリリースで未実装のコントロールが必要なため、選択できません。

## バージョン管理されたセキュリティ Posture

PostgreSQL には、デプロイ Tier、単調増加するセキュリティ Epoch、正規セキュリティ Posture Hash が保存されます。起動時の動作はフェイルクローズです。

- Tier と Posture が完全に一致する場合：通常起動します。
- 設定された Tier が保存済み Tier より低い場合：暗黙の Downgrade をブロックします。
- 設定された Tier が保存済み Tier より高い場合：Upgrade の検証が必要です。
- Tier は同じでも Posture Hash が異なる場合：明示的なマイグレーションが必要です。

明示的なマイグレーションでは、メンテナンスモードへ入り、新しい重要操作をブロックし、いずれかの Git Operation が `PUSHING` の場合は遷移を拒否します。また、Pending/Approved の Approval を Stale にし、未完了の Git Operation をキャンセルし、Active な Credential Lease を無効化し、Active な Workspace を停止し、Epoch を増加させ、追記専用の監査イベントを書き込みます。

古い Review Snapshot は引き続き読み取れますが、その Epoch と Posture のバインディングにより、マイグレーション後の操作を承認することはできません。既存の Workspace は停止され、新しいコンテキストで明示的に再起動する必要があります。

## Upgrade と Downgrade

Upgrade の前に、対象 Tier が要求するすべてのコントロールを実装および検証するバイナリをデプロイしてください。`instance_metadata` を手動で変更しないでください。

Downgrade には、[運用ガイド](./OPERATIONS.md#明示的なセキュリティ-posture-マイグレーション)に記載された明示的な管理ワークフローが必要です。`.env` を編集して再起動する方法では絶対に実行されません。失敗した、または結果が曖昧なマイグレーションでは、運用者が確認できるようにメンテナンスモードが維持されます。

## 認証情報の取り扱い

GitHub Installation Token のバイト列が PostgreSQL または Outbox に保存されることはありません。発行済み Lease はマイグレーション時にローカルで期限切れになります。Provider 側での失効は前提にしていないため、インシデントポリシーで必要な場合、デプロイ環境では短命な Provider Token の失効も待つ必要があります。
