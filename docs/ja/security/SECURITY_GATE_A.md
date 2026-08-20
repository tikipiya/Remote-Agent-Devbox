# Security Gate A — Workspace の分離

[English](../../security/SECURITY_GATE_A.md)

## 強制される特性

- Workspace プロセスは UID/GID `10001` で実行されます。
- Docker はすべての Linux Capability を削除し、`no-new-privileges` を設定します。
- ルートファイルシステムは読み取り専用です。ランタイム状態には、容量を制限した tmpfs マウントを使用します。
- CPU、メモリ、PID、実行時間の上限は必須設定です。
- Workspace データには、Workspace ごとに専用の Docker Volume を使用します。
- Workspace の code-server Port は公開されません。Host のループバックへ公開されるのは、専用 IDE Proxy だけです。
- Workspace コンテナは Workspace Network だけに参加します。
- PostgreSQL は内部 Control Network だけに参加します。
- `rad-control` が自身のプロセス環境を Workspace へ転送することはありません。
- Workspace の環境変数値は、Repository URL/Ref、Agent Branch、Workspace ID だけです。
- Docker Socket、GitHub Token、SSH Agent、Credential Helper、Proxy の認証情報は Workspace 内に存在しません。
- OpenAI のモデル ID は、Workspace ボリュームを持たない短命で読み取り専用の Agent Runner にのみ存在します。コマンドは Workspace 内の認証情報を持たない Codex Exec Server を通じて実行されます。
- IDE Proxy には Docker Socket、Database/Model/GitHub の認証情報、Workspace Volume がありません。Upstream へ転送する前に、自身の権限 Cookie を削除します。

## 自動ネガティブテスト

`security/gate-a/security-gate-a.test.ts` と Docker Supervisor のテストは、分離に関わる設定が退行すると失敗します。ネットワークへの参加、非 Root での実行、リソース制限フラグ、読み取り専用ルート設定、ループバックへの IDE Proxy 公開、Docker/GitHub 認証情報のマウントがないこと、Codex App Server の ID と Workspace の Exec Server が分離されていることを確認します。ワンタイム IDE のテストではさらに、権限情報がダイジェストだけで保存されること、直接 Port が撤去されていること、Proxy がハードニングされていること、セキュリティマイグレーションで無効化されることを強制します。

## 信頼境界

Docker Socket は `rad-control` だけにマウントされます。これにより、Tier 1 の信頼済み Control プロセスは Container Runtime を操作できます。これは明示的に Workspace へのマウントではなく、`rad-control` 自体の侵害を防ぐ境界であるとは主張していません。

専用 IDE Proxy も、IDE Traffic だけを Control Network と Workspace Network の間で中継するため、Tier 1 では信頼されます。Proxy は個別にハードニングされ、Control Plane の高価値な認証情報は一切受け取りません。

## デプロイ時の手動チェック

デプロイ環境が Security Gate A を満たすと判断する前に、次のチェックを実行してください。

```bash
docker inspect rad-ws-<workspace-id>
docker inspect remote-agent-devbox-ide-proxy-1
docker exec rad-ws-<workspace-id> test ! -S /var/run/docker.sock
docker exec rad-ws-<workspace-id> env
docker network inspect rad-control
docker network inspect rad-workspace
```

Workspace から Database または Control コンテナの名前解決や接続ができず、Host へ公開された Port がなく、制限値が設定と一致することを確認してください。ループバック公開を持つのが IDE Proxy だけであることも確認してください。
