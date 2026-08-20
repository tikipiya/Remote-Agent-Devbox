# 運用ガイド

[English](../OPERATIONS.md)

## ローカル Tier 1 の起動

1. Node.js 22.15 以降、Rootless Docker Engine 26 以降、Docker Compose をインストールします。
2. `.env.example` を `.env` へコピーし、PostgreSQL のパスワードを変更して、専用の OpenAI プロジェクトキーを `RAD_CODEX_API_KEY` に設定します。
3. Bot Application の準備ができていない場合、Discord の変数は空のままにします。
4. イメージをビルドします。

```bash
npm ci --ignore-scripts
npm run check
docker compose --profile build build
```

5. Validator のイメージ ID を解決し、完全な `sha256:...` の値を `.env` の `RAD_VALIDATOR_IMAGE_DIGEST` へコピーします。

```bash
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
```

6. サービスを起動します。

```bash
docker compose up -d
```

`http://127.0.0.1:3000` を開きます。

設定済み ID が存在しない、またはローカルイメージと一致しなくなった場合、検証はフェイルクローズします。Validator をリビルドした後は ID を再度解決し、明示的に更新してください。`remote-agent-devbox-validator:ci` タグが付いたビルド済みイメージを使用して、スタンドアロンの境界チェックを実行します。

```bash
npm run verify:validator
```

## 承認済み Git 書き込み用の GitHub App

対象の各 Repository に GitHub App を作成し、インストールします。次の Repository 権限だけを付与してください。

- Contents：Read and write
- Pull requests：Read and write

App に Webhook Subscription は必要ありません。数値の App ID と Installation ID を記録し、Private Key を生成して、完全な PEM File のバイト列を変えずに Base64 でエンコードします。次を設定してください。

```text
RAD_GITHUB_API_URL=https://api.github.com
RAD_GITHUB_APP_ID=<numeric-app-id>
RAD_GITHUB_INSTALLATION_ID=<numeric-installation-id>
RAD_GITHUB_PRIVATE_KEY_BASE64=<base64-encoded-pem>
```

認証情報を変更したら `rad-control` を再起動してください。Installation Token は、承認および厳密な最終再検証を終えた後にのみ要求され、対象 Repository にスコープされます。Remote Agent Devbox が Token を保存することはありません。

新規 PostgreSQL Volume では、すべてのスキーマが自動的に読み込まれます。既存の Volume で Git 書き込みを有効にする前に、Compose の Init Mapping にある `005_approval_requests.sql`、続いて `006_git_operations.sql` を適用してください。Database をバックアップし、`rad-control` と同じ Database Owner を使用して適用します。

認証情報を必要としないリモート compare-and-swap の境界テストをローカルで実行します。

```bash
npm run verify:git-cas
```

そのデプロイ環境が Security Gate C を満たすと判断する前に、イミュータブルな Review Snapshot を作成して承認し、そのデプロイ環境の GitHub App Installation を使用して実際の Pull Request を1件完了してください。本番環境の認証情報を CI で再利用しないでください。

## 既存データベースのマイグレーション

PostgreSQL の Init File が自動実行されるのは、データディレクトリが空の場合だけです。既存の Database をバックアップし、新しい Control イメージを起動する前に、次のマイルストーン 3 のファイルを順番に適用してください。

```text
007_operational_posture.sql
008_audit_events.sql
009_outbox_commands.sql
```

Source File と Compose Mapping は次のとおりです。

```text
packages/workspace-state/migrations/0002_operational_posture.sql
packages/audit-events/migrations/0001_audit_events.sql
packages/outbox/migrations/0001_outbox_commands.sql
```

`rad-control` に設定した Database Owner を使用して実行してください。`instance_metadata` を直接編集しないでください。

## 明示的なセキュリティ Posture マイグレーション

セキュリティ上重要な `.env` の値を変更すると、保存済み Posture を明示的に移行するまで通常の起動はフェイルクローズします。最初に `control` を停止し、新しい設定およびイメージをデプロイして、現在保存されている Tier と Epoch を確認します。

```bash
docker compose stop control
docker compose exec database psql -U rad -d rad -c \
  "SELECT deployment_tier, security_epoch, maintenance_mode FROM instance_metadata"
```

固定した運用者 UUID、シークレットを含まない理由、Query から導出した厳密な確認文字列を指定して管理コマンドを実行します。次の例では、Epoch 42 の Tier 1 を、設定済みの Tier 1 Posture へ移行します。

```bash
docker compose run --rm control \
  node apps/control/dist/admin.js security-migrate \
  --actor 10000000-0000-4000-8000-000000000001 \
  --reason "validator image rotation" \
  --confirm "MIGRATE EPOCH 42 TIER 1->1"
```

このコマンドは無効化処理の前にメンテナンスモードへ移行します。Git Operation が `PUSHING` の場合、または他の確認結果が曖昧な場合は失敗し、意図的にメンテナンスモードを維持します。Remote の結果と監査ログを確認し、Blocker を解消した後、同じ理由を使用して再試行してください。異なる理由による同時メンテナンスは拒否されます。

成功後は `control` を起動し、`/health` が新しい Epoch とともに `ok` を返すことを確認します。古い Approval は Stale になっていなければならず、運用者が Workspace を再起動する前に、Active な Workspace が `STOPPED` へ収束していなければなりません。

## バックアップと Restore

PostgreSQL と成果物 Volume を、1つのリカバリーポイントとしてまとめてバックアップしてください。GitHub Token のバイト列は保存されないため、バックアップには含まれません。

PostgreSQL の Restore 後は Control Service を公開しないでください。Tier と Posture Hash が変わっていない場合でも、`--rotate-epoch` を付けて明示的なマイグレーションコマンドを実行します。

```bash
docker compose run --rm control \
  node apps/control/dist/admin.js security-migrate \
  --actor 10000000-0000-4000-8000-000000000001 \
  --reason "post-restore epoch rotation" \
  --confirm "MIGRATE EPOCH 42 TIER 1->1" \
  --rotate-epoch
```

その後、Workspace を Reconcile し、`GET /api/audit-events` を確認します。新しい Epoch が確認できるまでサービスを再開しないでください。これにより、Restore された Approval が古いセキュリティコンテキストで Replay されることを防ぎます。

## Codex ID

Tier 1 ではキーは Control プロセス内に保持され、短命な信頼済み Agent Runner にのみ転送されます。Workspace の環境変数やマウント済みファイルシステムには配置されません。個人用 Shell の `CODEX_HOME` や、広範な権限を持つ組織キーは使用しないでください。

モデルを呼び出さずに、実際の App Server から Exec Server へのプロトコルを検証します。

```bash
npm run verify:codex-boundary
```

`RAD_CODEX_API_KEY` を Export した後、任意実行の認証済みチェックを実行します。このチェックは実際にモデルリクエストを行い、Codex が Exec Server を通じて一時 Repository を編集することを検証します。

```bash
npm run verify:codex-task
```

## Rootless Docker Socket

Default Socket は `/run/user/1000/docker.sock` です。Rootless Daemon が別の UID または場所を使用する場合、`.env` で `RAD_DOCKER_SOCKET` を設定してください。認証のない Remote Docker TCP Endpoint は使用しないでください。

## Discord

`RAD_DISCORD_TOKEN` と `RAD_DISCORD_APPLICATION_ID` は一緒に設定してください。開発中は `RAD_DISCORD_GUILD_ID` を設定すると、Guild Scope の Command がすぐに更新されます。Global な `/rad-task` Command を使用する場合は省略します。

Token は `rad-control` 内に保持されます。Workspace へ転送されることはありません。

## ライフサイクルのリカバリー

Reconciler は `RAD_RECONCILE_INTERVAL_MS` ごとに実行されます。操作に失敗しても、要求された Desired State は維持され、`observed_state = FAILED` が記録されます。これにより、Runtime の問題を修正した後、後続の Reconciliation で収束できます。

Workspace の Desired State の変更時には、シークレットを含まない Outbox Command も同じ Database Transaction 内で作成されます。Dispatcher は上限付きで再試行し、再起動後に古い Processing Claim を回収します。最終的な状態の収束については、引き続き Reconciler が責任を持ちます。

Workspace を Destroy すると、その Container と Data Volume の両方が削除されます。これは意図した動作で、Repository に Commit 済みの作業がない限り復旧できません。

## シャットダウン

```bash
docker compose down
```

PostgreSQL の状態を意図的に削除する場合に限り、`--volumes` を追加してください。Workspace Volume はライフサイクルの Destroy 操作によって削除されます。
