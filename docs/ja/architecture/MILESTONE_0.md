# マイルストーン 0 — Workspace の垂直スライス

[English](../../architecture/MILESTONE_0.md)

## ステータス

マイルストーン 0 は、実行可能な基盤として実装済みです。認証情報から分離された Codex のプロセス境界とコンテナビルドは自動化されていますが、完了には、運用者が用意したプロジェクトキーを使用して、デプロイ環境で認証済み Codex タスクを1回実行する必要があります。

## リクエストフロー

```text
Discord / Web
      |
      v
rad-control（Fastify モジュラーモノリス）
      |-- PostgreSQL：repository、workspace、task の状態
      |-- Reconciler：desired state -> observed state
      `-- Docker CLI：冪等なサンドボックス操作
                       |
                       v
                 Workspace コンテナ
                 |-- 公開リポジトリのクローン
                 |-- code-server
                 `-- Codex Exec Server <--- 短命な Agent Runner
                                             `-- Codex App Server + モデル ID
```

`rad-control` は Tier 1 の信頼基盤（TCB）です。その内部モジュールは論理的なアーキテクチャ境界であり、侵害を封じ込める境界ではありません。Workspace コンテナとその専用 Docker ネットワークは、強制される分離境界です。

## 状態モデル

Workspace の状態には、独立した `desired_state`、`observed_state`、単調増加する `state_version` カラムを使用します。すべての更新は楽観的 compare-and-set セマンティクスを使用します。同期コーディネーターが最初の試行を行い、定期的な Reconciler が中断された操作を修復します。

サンドボックス操作は冪等です。

- create は既存のコンテナとボリュームを受け入れます。
- start は正常に稼働中のコンテナを受け入れます。
- stop はコンテナが存在しない、または停止済みの状態を受け入れます。
- destroy はコンテナまたはボリュームが存在しない状態を受け入れます。

## Codex App Server の契約

Worker は Codex CLI `0.148.0` から生成されたプロトコルを使用します。

1. `initialize`
2. `initialized`
3. `environment/add` と `environment/status`
4. `thread/start`
5. `turn/start`
6. `turn/completed`

Thread では `approvalPolicy: never`、`sandbox: workspace-write`、単一のリモート環境とランタイム Workspace ルートを使用し、マルチエージェントモードは使用しません。予期しないサーバーからクライアントへのリクエストは拒否されます。

このプロトコルは引き続き実験的です。Workspace イメージ内では CLI のバージョンを固定しているため、アップグレードにはコードとスキーマの明示的なレビューが必要です。

## 現在の制限事項

- クローンできるのは、公開 HTTPS Git リポジトリのみです。
- エージェントタスクを実行する前に、運用者が専用の `RAD_CODEX_API_KEY` を用意する必要があります。キーは短命な信頼済み Agent Runner にのみ注入され、Workspace にマウントまたは転送されることはありません。[Codex ID 境界](./CODEX_IDENTITY_BOUNDARY.md)を参照してください。
- IDE アクセスは、マイルストーン 4 のワンタイムアクセス Proxy を介するようになりました。Workspace の code-server Port は直接公開されません。
- 新規ボリュームでは、PostgreSQL の初期化スクリプトによってデータベースマイグレーションが適用されます。既存インストール向けのアップグレードマイグレーションは実装されていません。
- Transactional Outbox、承認、Git 書き込みは後続マイルストーンの対象です。成果物レビューは、マイルストーン 1 のイミュータブルなレビューパイプラインで実装されています。
