# Codex ID 境界

[English](../../architecture/CODEX_IDENTITY_BOUNDARY.md)

## 決定事項

Codex のモデル ID は、信頼されない Workspace コンテナではなく、短命な信頼済み Agent Runner に属します。各タスクでは、別々のコンテナ内にある2つのプロセスを使用します。

```text
信頼済み Agent Runner                       信頼されない Workspace

OPENAI_API_KEY                              モデル認証情報なし
Codex App Server  -- WebSocket loopback --> Codex Exec Server
モデルリクエスト                            ファイル操作とコマンド実行
```

Runner は `--network container:<workspace>` によって Workspace のネットワーク名前空間を共有します。Exec Server は `127.0.0.1:4500` だけで Listen し、ホストポートを公開せず、Control Network にも参加しません。Runner には Workspace ボリュームがマウントされません。Codex は Thread と Turn でリモート環境を選択するため、Repository の読み取り、書き込み、コマンドは Workspace 内の Exec Server によって処理されます。

## シークレットの取り扱い

- `RAD_CODEX_API_KEY` は Tier 1 の Control プロセスが保持します。
- Docker は Docker CLI の子プロセス環境を通じて値を受け取ります。値はコマンドライン引数には配置されません。
- Docker は、短命な Runner にのみ `OPENAI_API_KEY` として値を転送します。
- Runner のルートファイルシステムは読み取り専用で、`CODEX_HOME` には一時的な tmpfs を使用し、タスク後は `--rm` によって削除されます。
- Workspace の起動時に、その環境から `OPENAI_API_KEY` と `CODEX_ACCESS_TOKEN` を明示的に削除します。
- Workspace には Runner のファイルシステムも Docker Socket も存在しないため、Repository のコードから Runner の環境やコンテナメタデータを調べることはできません。

Docker Daemon と `rad-control` は、引き続き Tier 1 の信頼基盤内にあります。運用者は、適切な利用上限を設定した専用の OpenAI プロジェクトキーを使用し、個人の認証情報とは別にローテーションしてください。

## 障害時の動作

キーがない場合、タスクの実行は `CODEX_IDENTITY_NOT_CONFIGURED` で拒否されます。App Server は固定された実験的な Remote Environment API を必須とし、`environment/status=ready` を待機します。切断、未知の状態、タイムアウト時にはフェイルクローズします。予期しない App Server リクエストは引き続き拒否されます。

## 検証

`npm run verify:codex-boundary` は、固定された Codex App Server と Exec Server を実際のプロセスとして起動し、リモート環境へ接続しますが、モデルリクエストは行いません。CI では、本番用 Workspace イメージ内で同じチェックを繰り返します。Supervisor と Security Gate A のテストでは、Docker 引数にキーの値が含まれないこと、および Workspace に認証情報や Runner のボリュームがマウントされていないことも検証します。

`npm run verify:codex-task` は、運用者が明示的に実行する完了チェックです。`RAD_CODEX_API_KEY` が必要で、実際のモデルリクエストを行い、認証情報を持たない Exec Server を介して、使い捨て Repository 内で編集が実行されることを検証します。
