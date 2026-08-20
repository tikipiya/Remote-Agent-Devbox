# マイルストーン 2 — 承認済み Git 書き込みパイプライン

[English](../../architecture/MILESTONE_2.md)

## ステータス

マイルストーン 2 では、Tier 1 の人間による承認、厳密な最終再検証、リモート compare-and-swap、短命な GitHub App 認証情報、Agent Branch への Push、Pull Request 作成のパイプラインを実装しています。認証済みデプロイチェックには、引き続き運用者が用意した GitHub App のインストールが必要です。

## 完全性チェーン

```text
イミュータブルな Review Snapshot
  -> 有効期限付きの人間による承認
  -> 現在のセキュリティ Epoch/Posture の確認
  -> ネットワークを使用しない厳密な再検証
  -> 承認済みレビューダイジェストの再現
  -> 観測したリモート Agent Branch の HEAD
  -> 認証情報 Lease の予約
  -> Repository スコープの GitHub App Installation Token
  -> 現在の Epoch の確認
  -> 明示的な force-with-lease CAS Push
  -> 設定済み Default Branch への Pull Request
```

承認の作成と決定を行うトランザクションは、Review Snapshot と単一行のセキュリティメタデータをロックして比較します。レビューダイジェストと Validator プロファイルダイジェスト、セキュリティ Epoch、デプロイ Tier、Posture Hash を結び付けます。有効期限切れまたは不一致の決定は、承認されず `STALE` になります。

1つの承認から作成できる Git Operation は最大1つです。Operation の作成時にも、承認ステータスと有効期限、イミュータブルなレビューのバインディング、現在のセキュリティメタデータを1つのトランザクション内で再確認します。

## 最終再検証

認証情報を発行する前に、元のコンテンツアドレス方式の成果物を、ダイジェストが厳密に固定された同じ Validator プロファイルで再度解析します。Control Plane は CRF-1 を再構築し、承認済みレビューダイジェストが完全に再現されることを要求します。プロファイル、成果物、ポリシー、Epoch、Posture、マニフェストのいずれかに差異があれば、Operation は `STALE` になります。

## リモート CAS

書き込み可能なのは、該当 Workspace の Branch `agent/<workspace UUID>` だけです。リモートアクセスの前に、設定済み Default Branch とその他すべての Ref を拒否します。Push に含まれる Refspec は1つだけで、次を使用します。

```text
--force-with-lease=refs/heads/<agent-branch>:<observed-head>
```

期待値が空の場合、リモート Branch が存在しないことを要求します。HEAD が変化していれば `CONFLICT` となり、対象を無条件に Force Push することはありません。

## 認証情報 Lease

GitHub App Token のリクエストは1つの Repository にスコープされ、権限は `contents:write` と `pull_requests:write` だけです。Token のバイト列が PostgreSQL、成果物ストア、Workspace ストレージ、コマンド引数、ログへ書き込まれることはありません。データベースには Lease の状態と時刻だけが保持されます。

確定的な CAS の拒否でも、1回限りの認証情報は消費されます。外部結果が曖昧な場合、Lease を `UNCERTAIN` としてフェイルクローズし、自動的な再試行や再発行は一切行いません。

## HTTP インターフェース

- `POST /api/reviews/:id/approvals`
- `GET /api/approvals/:id`
- `POST /api/approvals/:id/decision`
- `POST /api/approvals/:id/git-operations`
- `GET /api/git-operations/:id`

## 現在の制限事項

- Tier 1 のローカル UI は UUID の Actor を記録しますが、強力なマルチユーザー認証はまだ提供していません。Control API はホストのループバックにバインドしたままにしてください。
- 明示的な Branch ポリシーは `agent/<workspace UUID>` だけを許可し、Default Branch をブロックします。Repository 固有の Protected Branch 検出は、GitHub App の権限を広げることになるため要求していません。
- Control プロセスのクラッシュ後、`PUSHING` と `UNCERTAIN` の状態は手動で確認する必要があります。外部副作用の自動リカバリーは意図的に無効化しています。
- 既存の PostgreSQL ボリュームには、運用者がマイグレーション 005 と 006 を適用する必要があります。
