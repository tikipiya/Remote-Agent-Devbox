# Remote Agent Devbox

[English](./README.md)

Remote Agent Devbox は、分離された使い捨ての Workspace で AI Coding Agent を実行するためのセルフホスト型 Runtime です。[PLAN.md](./PLAN.md) に記載された v0.9 アーキテクチャを正とします。

現在の実装は **Tier 1 — Secure Personal / Small Team** を対象とし、マイルストーン 3 の運用セキュリティ Posture パイプラインを含みます。

## セキュリティモデル

- Workspace は信頼されません。
- Docker Socket または GitHub の書き込み認証情報が Workspace にマウントされることはありません。
- Codex のモデル ID は、独立した短命な Agent Runner が保持します。
- Workspace と Control Plane のネットワークは分離されています。
- リソース制限は必須であり、設定に問題がある場合はフェイルクローズします。
- Workspace の Desired State と Observed State は個別に保存されます。
- Git Artifact には信頼済みサーバーがダイジェストを付与し、ダイジェスト固定されたネットワークなしの Validator が解析します。
- CRF-1 Review Snapshot は、厳密な Validator とセキュリティコンテキストを結び付けます。
- 有効期限付きの人間による承認は、イミュータブルなレビューと現在のセキュリティ Epoch に結び付けられます。
- 最終再検証、1回限りの Credential Lease、リモート compare-and-swap によって、書き込み先を Workspace 専用の Agent Branch に制限します。
- 暗黙のセキュリティ Posture 変更はブロックされます。明示的なマイグレーションでは、メンテナンスモード、単調増加する Epoch、状態の無効化、追記専用の監査を使用します。
- シークレットを含まない Transactional Outbox が、Workspace の状態変更の意図を冪等な Reconciler へ永続的に配信します。
- Epoch に結び付いたワンタイム IDE コードは、ハードニングされた Proxy で短命な Session に交換されます。Workspace の code-server Port は直接公開されません。

信頼境界とデプロイに関する主張については、[セキュリティポリシー](./SECURITY.ja.md)を参照してください。

## 開発

必要要件：Node.js 22 以降、Compose を備えた Docker Engine 26 以降、PostgreSQL 16 以降。

Agent Task を実行するには、`.env` に `RAD_CODEX_API_KEY` を設定します。このキーには専用の OpenAI プロジェクトのものを使用してください。Workspace へ転送されることはありません。

```bash
cp .env.example .env
npm ci
npm run check
docker compose --profile build build
# Validator の正確なイメージ ID を .env の RAD_VALIDATOR_IMAGE_DIGEST へコピーします：
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
docker compose up
```

承認済みの Git 書き込みには、対象 Repository にインストールされた GitHub App も必要です。厳密な権限と環境変数については、[運用ガイド](./docs/ja/OPERATIONS.md#承認済み-git-書き込み用の-github-app)を参照してください。これらの認証情報がない場合、Git Operation の作成はリモートアクセスより前にフェイルクローズします。

HTTP Service はデフォルトで `127.0.0.1:3000` を Listen します。Discord の両方の環境変数が指定されていない限り、Discord 連携は無効です。

## ドキュメント

- [日本語ドキュメント一覧](./docs/ja/README.md)
- [マイルストーン 0 のアーキテクチャ](./docs/ja/architecture/MILESTONE_0.md)
- [マイルストーン 1 — イミュータブルなレビューパイプライン](./docs/ja/architecture/MILESTONE_1.md)
- [マイルストーン 2 — 承認済み Git 書き込みパイプライン](./docs/ja/architecture/MILESTONE_2.md)
- [マイルストーン 3 — 運用上のセキュリティ Posture](./docs/ja/architecture/MILESTONE_3.md)
- [マイルストーン 4 — ワンタイム IDE アクセス](./docs/ja/architecture/MILESTONE_4_IDE_ACCESS.md)
- [デプロイ Tier](./docs/ja/DEPLOYMENT_TIERS.md)
- [Codex ID 境界](./docs/ja/architecture/CODEX_IDENTITY_BOUNDARY.md)
- [Security Gate A](./docs/ja/security/SECURITY_GATE_A.md)
- [Security Gate B](./docs/ja/security/SECURITY_GATE_B.md)
- [Security Gate C](./docs/ja/security/SECURITY_GATE_C.md)
- [Security Gate D](./docs/ja/security/SECURITY_GATE_D.md)
- [運用ガイド](./docs/ja/OPERATIONS.md)
