# Security Gate B — 成果物の完全性

[English](../../security/SECURITY_GATE_B.md)

## 強制される特性

- 成果物の SHA-256 は信頼済みサーバーコードが計算し、Workspace から受け取ることはありません。
- 成果物ストレージはコンテンツアドレス方式で、上書き不可であり、Commit 後は読み取り専用です。
- 成果物ごとに専用のダイジェストディレクトリがあります。Validator に渡されるのは、そのディレクトリだけを対象とした読み取り専用 Docker Volume Subpath です。
- Validator イメージ ID は運用者が設定した SHA-256 と完全に一致する必要があり、コンテナはその ID によって起動されます。
- Validator コンテナはネットワークを持たず、ルートは読み取り専用で、Linux Capability はなく、`no-new-privileges` と非 Root UID を使用します。また、CPU、メモリ、PID、File Descriptor、出力、実行時間に上限があります。
- Git が成果物のバイト列を解析する前に、分離された Validator 内で再度 Hash を計算します。
- 生の Git パスバイト列は正規 Base64 として維持されます。CRF-1 の並び順と Hash は決定的です。
- レビューダイジェストは、厳密な Validator プロファイルと現在のセキュリティ Epoch、Tier、Posture、成果物、ポリシー、Commit、Tree、変更ファイル構造を結び付けます。
- Review Snapshot の Repository Method は Create と Read だけです。Snapshot の作成と成果物の検証状態への遷移は Atomic です。
- 保存された ID フィールドまたは再計算したダイジェストが一致しない場合、Snapshot の読み取りはフェイルクローズします。

## 自動チェック

`npm run check` は、コンテンツアドレス方式のストレージ、安全でないストレージおよび Ref の拒否、生の非 UTF-8 パスの保持、CRF の決定性、プロファイルの固定、Docker の分離引数、セキュリティ Epoch の競合、Review Snapshot の冪等性を検証します。

CI では実際の Validator イメージもビルドし、`npm run verify:validator` を実行します。このチェックは実際の Git Bundle を作成し、Control Plane と同じダイジェストサブディレクトリのマウントを使用して、ネットワークのない読み取り専用コンテナ内で Base、Target、Tree、Path、成果物ダイジェストを検証します。

## デプロイでの有効化

`volume-subpath` を使用するには Docker Engine 26 以降が必要です。Validator イメージをビルドした後、その正確なローカル ID を記録します。

```bash
docker image inspect --format '{{.Id}}' remote-agent-devbox-validator:local
```

結果を `RAD_VALIDATOR_IMAGE_DIGEST` に設定し、`rad-control` を再起動してください。値がない、または一致しない場合、可変イメージタグへフォールバックせず、検証機能は無効のままです。

## 信頼に関する声明

Gate B は、成果物 Parser のネットワークアクセスを防ぎ、読み取りおよび変更可能なデータを制限します。Tier 1 では、引き続き `rad-control`、Docker Daemon、Database 管理者、Host 管理者の侵害を、信頼境界の侵害として扱います。
