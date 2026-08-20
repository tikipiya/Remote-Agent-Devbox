# マイルストーン 4 — ワンタイム IDE アクセス

[English](../../architecture/MILESTONE_4_IDE_ACCESS.md)

## ステータス

マイルストーン 4 のハードニング項目であるワンタイム IDE アクセスを Tier 1 向けに実装しています。P3 の他のハードニング項目は、引き続き別作業です。

## アクセスフロー

```text
READY 状態の Workspace
  -> Control が256ビットのワンタイムコードを発行
  -> PostgreSQL は SHA-256(code) だけを保存
  -> Browser はコードを URL Fragment に含む IDE Proxy URL を受信
  -> 上限付き POST 交換の前に Fragment を削除
  -> Control がコードを Atomic に消費し、短命な Session を作成
  -> IDE Proxy が HttpOnly、SameSite=Strict Cookie を設定
  -> HTTP/WebSocket 接続のたびに Control で Session を再検証
  -> IDE Proxy が Workspace Network 上の code-server へ転送
```

コードはデプロイ Tier、セキュリティ Epoch、Workspace ID、厳密な Workspace `state_version`、有効期限に結び付けられます。代替コードを発行すると、その Workspace の未使用コードが無効になります。コードを交換すると以前の Active Session が失効し、消費済みコードを再利用することはできません。

生のコードは URL Fragment で運ばれるため、HTTP Request または Referer には送信されません。Bootstrap は交換前に Browser History からコードを削除します。PostgreSQL、監査イベント、ログにはコードまたは Session Token のバイト列を保持しません。

## Proxy 境界

Workspace コンテナは code-server Port を Host へ直接公開しなくなりました。ループバックへ公開される IDE Endpoint は専用の `ide-proxy` だけです。この Proxy は Control Network と Workspace Network に参加しますが、Docker Socket、Database 認証情報、モデル ID、GitHub 認証情報、Workspace Volume を持ちません。非 Root、読み取り専用ルート、すべての Linux Capability を削除、`no-new-privileges` を設定した状態で実行されます。

Proxy は専用の共有シークレットを使用して内部 Control Endpoint を認証します。転送前に IDE の権限 Cookie と Authorization Header を削除します。権限と無関係な Upstream Cookie は、該当 Workspace の Path に制限されます。

## 無効化

メンテナンス中、有効期限後、セキュリティ Epoch の変更後、Workspace の状態または Version が変わった場合、Session の解決はフェイルクローズします。明示的なセキュリティ Posture マイグレーションでは、Epoch を進める同じトランザクション内で、すべての未使用 IDE コードを無効化し、すべての Active IDE Session を失効させます。

## Tier 1 の制限事項

- IDE Proxy は Tier 1 の信頼基盤に含まれます。
- Public Proxy URL のデフォルトは Host のループバックです。Remote 公開には、運用者が管理する HTTPS Endpoint と、それに対応する `RAD_IDE_PROXY_PUBLIC_URL` が必要です。
- ローカル UI は UUID の Actor を記録しますが、強力なマルチユーザー認証は提供していません。
- この実装は、P3 の残りのハードニング項目の完了を主張するものではありません。
