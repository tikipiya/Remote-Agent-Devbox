# セキュリティポリシー

[English](./SECURITY.md)

## サポート対象のセキュリティ Tier

初期実装は Tier 1（Secure Personal / Small Team）を対象としています。悪意のある Host 管理者、または信頼済み Control プロセスの侵害から保護されるとは主張しません。

Tier 1 では、`rad-control` 内部で論理的な権限分離を使用します。これらのモジュール境界は、意図しない権限の誤用を減らし、監査可能性を向上させますが、`rad-control` プロセス自体の侵害からは保護しません。`rad-control` の侵害は、Tier 1 の信頼済み Control 境界の侵害とみなされます。

Workspace コンテナと検証コンテナは、強制される分離境界です。Workspace に Docker Socket、GitHub の書き込み認証情報、Control Plane の認証情報、または Control Network への経路を与えてはなりません。

承認済み Git 書き込みパスでは、有効期限付きの承認をイミュータブルなレビューと現在のセキュリティ Epoch に結び付けた後、Workspace 専用の Agent Branch へ1回だけ compare-and-swap Push する前に、厳密な検証を繰り返します。GitHub App Installation Token は Repository にスコープされ、メモリ内だけに保持されます。強制される特性とデプロイ時の検証要件については、[Security Gate C](./docs/ja/security/SECURITY_GATE_C.md)を参照してください。

セキュリティ設定は、バージョン管理される運用状態です。既存 Database の Tier または Posture Hash が、環境変数の値から暗黙に同期されることはありません。明示的なマイグレーションはメンテナンスモードへ移行し、古い認可状態を無効化して、単調増加するセキュリティ Epoch を増加させます。監査行は、Application Database Role に対して追記専用です。これらのコントロールは、信頼済み Host または PostgreSQL Superuser が Database を直接変更することからは保護しません。[Security Gate D](./docs/ja/security/SECURITY_GATE_D.md)および[デプロイ Tier](./docs/ja/DEPLOYMENT_TIERS.md)を参照してください。

## 脆弱性の報告

未公開の脆弱性について Public Issue を作成しないでください。この Repository の GitHub Private Vulnerability Reporting 機能を使用してください。
