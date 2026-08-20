# Remote Agent Devbox

## Discord駆動・隔離AI開発環境 詳細設計書 v0.9

**文書バージョン:** 0.9 Draft
**想定ライセンス:** Apache-2.0
**想定形態:** OSS / Self-hosted
**初期リリース対象:** Personal / Small Team
**将来到達点:** Hardened Multi-user / Public Multi-tenant
**主要Git Provider:** GitHub
**主要Agent Provider:** OpenAI Codex
**更新日:** 2026-08-20

---

# 1. 概要

Remote Agent Devboxは、Discord、Web UI、CLI等のRemote InterfaceからAIコーディングエージェントへ開発指示を送り、隔離されたEphemeral Development Workspace内でコード編集・ビルド・テストを実行させ、人間が確認・承認した変更だけを安全なGit Pipelineを介してGitHubへ反映するSelf-hosted AI Development Runtimeである。

ユーザー体験は次のように単純である。

```text
スマートフォン
    ↓
Discord
    ↓
「Issue #42を修正して」
    ↓
AIが隔離Workspaceで作業
    ↓
Build / Test
    ↓
Canonical Review
    ↓
Human Approval
    ↓
Secure Git Write
    ↓
Pull Request
```

一方、内部では次の要素を無条件には信用しない。

```text
Agent
Repository
Dependencies
Build Scripts
Tests
IDE Extensions
Workspace
Git Artifact
Git Parser
Review Rendering
```

v0.9ではv0.8で導入した、

```text
Reference Architecture
Release Architecture
Security Tiers
```

という分離を維持しつつ、さらに実運用上重要となる、

```text
Tier 1 Trusted Computing Base
Logical vs Enforced Privilege Separation
Desired / Observed State
Security Posture
Security Epoch
Tier Upgrade / Downgrade
Approval Invalidation
```

を正式に定義する。

---

# 2. v0.9の主要変更

v0.8から以下を追加・変更する。

## 2.1 Tier 1 Trusted Computing Baseの明確化

Tier 1では`rad-control`内部のModule分離をSecurity Boundaryとはみなさない。

```text
Auth
Policy
Approval
Git Operation
Token Issuance
```

等は論理的に分離するが、

> `rad-control`プロセス自体が侵害された場合、Tier 1 Trusted Control Boundary全体が侵害されたものとみなす。

---

## 2.2 Logical Privilege SeparationとEnforced Privilege Separationの分離

同一Process内のModule Boundaryと、Process/Container/Network/Credential Boundaryを区別する。

---

## 2.3 Desired / Observed Stateは初期から導入

Workspace Lifecycleでは、

```text
desired_state
observed_state
state_version
```

を初期実装から保持する。

---

## 2.4 Transactional OutboxはHardeningへ移動

Prototype / 初期Releaseでは、

```text
synchronous lifecycle call
+
idempotent operation
+
Reconciler
```

を採用する。

Transactional OutboxはMilestone 4以降へ移動する。

---

## 2.5 Security Postureの導入

Deployment Tier、重要Policy、Validator Trust等のSecurity Contextを、

```text
Security Posture
```

として明示的に扱う。

---

## 2.6 Security Epochの導入

重大なSecurity Context変更を、

```text
security_epoch
```

というMonotonic Counterへ反映する。

Review、Approval、Git OperationはSecurity Epochへbindingされる。

---

## 2.7 Tier Downgradeを明示的Migrationに変更

単なるConfig変更で、

```text
Tier 1 → Tier 0
```

等へ降格できない。

DowngradeはSecurity-sensitive Administrative Operationとして扱う。

---

# 3. 設計目標

本プロジェクトは次の4つを両立する。

```text
Useful
Secure
Implementable
Evolvable
```

より具体的には、

```text
1. 遠隔AI開発環境として実用的である。

2. Agentの善意にSecurityを依存しない。

3. 個人〜小規模OSSチームでも完成可能である。

4. 後からMulti-user / High-Assuranceへ拡張できる。
```

---

# 4. Security Model

以下をUntrustedとする。

```text
Workspace
Repository
Agent
Dependency
Build Script
Test Script
Package Manager Hook
IDE Extension
Git Artifact
Artifact Manifest
Git parser input
```

Tier 1では以下をTrusted Computing Baseとする。

```text
Host OS / Host Administrator
rad-control
PostgreSQL
GitHub App secret storage
Docker / container runtime management plane
Configured validator image identity
```

---

# 5. Tier 1 Trusted Computing Base

Tier 1では、

```text
┌────────────────────────────────────┐
│ Tier 1 Trusted Computing Base      │
│                                    │
│ Host OS                            │
│ rad-control                        │
│ PostgreSQL                         │
│ Docker management plane            │
│ GitHub App key storage             │
│ Validator configuration            │
└────────────────────────────────────┘

──────────── Security Boundary ────────────

┌────────────────────────────────────┐
│ Untrusted Workspace                │
│                                    │
│ Agent                              │
│ Repository                         │
│ Dependencies                       │
│ Build/Test                         │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ Isolated Validation                │
│                                    │
│ Untrusted Git parsing              │
│ Network = NONE                     │
└────────────────────────────────────┘
```

とする。

---

# 6. Tier 1 Security Claim

Tier 1は、

> Workspace compromiseからTrusted Host/Control Planeを保護する

ことを目標とする。

しかし、

> `rad-control`プロセス自身の完全侵害からGitHub Credential Authorityを保護する

ことは保証しない。

これはTier 2以降でProcess Separationを導入する理由である。

---

# 7. Modular Monolithの位置付け

Tier 1では`rad-control`をModular Monolithとして実装する。

```text
rad-control
├─ AuthModule
├─ PolicyModule
├─ WorkspaceStateModule
├─ ApprovalModule
├─ ReviewModule
├─ ValidationLauncherModule
├─ GitOperationModule
└─ GitHubTokenIssuerModule
```

---

# 8. Module BoundaryはSecurity Boundaryではない

重要なInvariant:

> In-process module boundaries are architectural boundaries, not isolation boundaries.

例えば、

```text
GitOperationModule
```

だけが、

```text
GitHubTokenIssuerModule
```

を呼ぶ設計にしても、

`rad-control` process全体がRCE等で侵害された場合、その制約は強制できない。

---

# 9. Logical Privilege Separation

Tier 1では以下を用いる。

```text
Module API
Dependency direction
Package visibility
Lint rules
Import restrictions
CODEOWNERS
Unit tests
Integration tests
```

目的は、

```text
Accidental misuse prevention
Auditability
Future process extraction
```

である。

---

# 10. Enforced Privilege Separation

真のSecurity Boundaryとなるもの:

```text
Process boundary
Container boundary
Network namespace
Filesystem namespace
OS user
Credential boundary
mTLS/workload identity
Separate secret storage
```

Tier 2/3ではHigh-value Moduleをこれらへ昇格する。

---

# 11. Module → Service Evolution

例:

```text
Tier 1
rad-control
 ├─ GitOperationModule
 └─ GitHubTokenIssuerModule
```

↓

```text
Tier 2
rad-control
      ↓
Git Operation Service
      ↓
Token Issuer Service
```

Interfaceは維持する。

---

# 12. Security Documentation Requirement

`SECURITY.md`にはTier 1について、

```text
Tier 1 uses logical privilege separation inside rad-control.

These module boundaries reduce accidental privilege misuse and
improve auditability, but they do not protect against compromise
of the rad-control process itself.

Compromise of rad-control is considered compromise of the Tier 1
trusted control boundary.
```

という趣旨を明示する。

---

# 13. Security Tiers

v0.8同様、4 Tier。

```text
Tier 0 — Developer Prototype
Tier 1 — Secure Personal / Small Team
Tier 2 — Hardened Multi-user
Tier 3 — High-Assurance / Public Multi-tenant
```

---

# 14. Tier 0

目的:

```text
機能検証
開発
ローカル利用
```

Security Claimは最小。

不特定Internet公開を前提にしない。

---

# 15. Tier 1

最初の正式OSS Target。

必須:

```text
Workspace isolation

No GitHub credential in workspace

Networkless Git validation

Server-side artifact digest

CRF

Structural Review Manifest

Human Approval binding

Exact validator profile

Final re-validation

Remote branch CAS

Short-lived GitHub credential

Resource quotas

TTL

Audit
```

---

# 16. Tier 2

追加:

```text
Dedicated Git Operation Service
Dedicated Token Issuer
Service identities
RBAC
Organization Policies
gVisor
Per-user quotas
Review policies
Advanced egress
```

---

# 17. Tier 3

追加:

```text
Validator signatures
Trust anchors
Supply-chain provenance
SBOM enforcement
Profile Registry
KMS/HSM
Firecracker
Dedicated worker nodes
Multi-maintainer activation
```

---

# 18. Core Security Invariants

Tier 1以上で必須。

```text
1. WorkspaceへGitHub write credentialを渡さない。

2. WorkspaceからControl Plane/DB/Host management interfaceへ
   到達できない。

3. WorkspaceにDocker socketを渡さない。

4. Git Artifact Identityはserver-side digestで決定する。

5. Git parsingはnetworkless validation environmentで行う。

6. Human Approvalはimmutable Structural Reviewへbindする。

7. Validatorはdigest-pinnedである。

8. Final re-validationはexact validator profileを使用する。

9. Remote branchが変化した場合pushしない。

10. Credentialはshort-livedかつminimum privilege。

11. Security-sensitive ambiguityはFail Closed。

12. Protected branchへのAgent direct pushは禁止。
```

---

# 19. Hardening Invariants

Tier 2/3:

```text
Service separation
Validator signature
Trust anchor
Provenance
SBOM
Multi-party activation
KMS/HSM
gVisor
Firecracker
External append-only audit
```

---

# 20. Workspace Lifecycle Model

v0.9では、

```text
desired_state
observed_state
```

を正式採用する。

---

# 21. Desired State

Operator/Userが望む状態。

```text
RUNNING
SUSPENDED
STOPPED
DESTROYED
```

程度の粗い状態でよい。

---

# 22. Observed State

Runtimeが実際に観測している状態。

```text
MISSING
PROVISIONING
STARTING
READY
BUSY
SUSPENDING
SUSPENDED
STOPPING
STOPPED
DESTROYING
DESTROYED
FAILED
```

---

# 23. Workspace Table

```sql
workspaces (
    id UUID PRIMARY KEY,

    owner_user_id UUID NOT NULL,
    repository_id UUID NOT NULL,

    desired_state TEXT NOT NULL,
    observed_state TEXT NOT NULL,

    state_version BIGINT NOT NULL DEFAULT 0,

    sandbox_backend TEXT NOT NULL,

    branch_name TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
)
```

---

# 24. Desired / Observed Splitを初期から入れる理由

Implementation Costが比較的小さく、

```text
Docker operation failure
process crash
restart
reconcile
```

に強くなるため。

Transactional Outboxほど複雑ではない。

---

# 25. Initial Lifecycle Implementation

Milestone 0〜3では同期処理を許可。

例:

```text
User requests RUNNING
     ↓
DB desired_state = RUNNING
     ↓
Sandbox create/start
     ↓
DB observed_state = READY
```

---

# 26. Failure Example

Docker start途中でProcess crash:

```text
desired_state = RUNNING
observed_state = PROVISIONING
```

Restart後Reconcilerが状態を確認する。

---

# 27. Reconciler

責務:

```text
Read desired state
Read observed state
Inspect actual runtime
Determine corrective action
Execute idempotently
Update observed state
```

---

# 28. Idempotent Sandbox Operations

初期から必須。

```text
ensureCreated(workspaceId)

ensureRunning(workspaceId)

ensureStopped(workspaceId)

ensureDestroyed(workspaceId)
```

という形を推奨。

---

# 29. Idempotency Example

```text
ensureDestroyed(ws123)
```

を2回呼んでも、

```text
already absent
```

を成功相当とする。

---

# 30. Why Idempotency Early

将来、

```text
Reconciler
Transactional Outbox
Retries
Distributed Workers
```

へ移行しやすくなる。

---

# 31. Transactional Outbox

v0.9ではCore MVPから外す。

導入時期:

```text
Milestone 4+
```

。

---

# 32. Outbox導入前

```text
DB update
 ↓
synchronous sandbox call
 ↓
DB observed update
```

失敗はReconcilerで補正。

---

# 33. Outbox導入後

```text
BEGIN

UPDATE desired_state

INSERT outbox_command

COMMIT
```

↓

```text
Outbox Worker
 ↓
execute side effect
 ↓
update observed state
```

---

# 34. Outbox導入Trigger

以下が問題になった段階で追加。

```text
Frequent process crashes

Many concurrent lifecycle operations

Distributed workers

Retry visibility needed

Durable command history needed

Docker/VM side-effect mismatch becomes operational pain
```

---

# 35. State Version

```text
state_version
```

は初期から保持。

State-changing requestは必要に応じて、

```text
expected_version
```

を使う。

---

# 36. Security Posture

v0.9で正式導入。

Security Postureとは、

> 現在のInstanceでSecurity-sensitive operationが成立する前提条件の集合

である。

---

# 37. Security Posture Components

少なくとも以下を含み得る。

```text
Deployment Tier

Critical System Policy

Validator Trust Configuration

Validator Profile Set

Git Security Policy

Trust Anchors

Credential Authority Configuration

Emergency Security Flags
```

---

# 38. Security Epoch

Security Postureの重大な変更を表すMonotonic Counter。

```sql
security_epoch BIGINT NOT NULL
```

。

---

# 39. Instance Metadata

```sql
instance_metadata (
    singleton_id BOOLEAN PRIMARY KEY DEFAULT TRUE,

    deployment_tier INTEGER NOT NULL,

    security_epoch BIGINT NOT NULL,

    security_posture_hash TEXT NOT NULL,

    updated_at TIMESTAMPTZ NOT NULL
)
```

実際にはsingleton patternを別方式にしてもよい。

---

# 40. Security Epochの意味

Epoch `42`で作成されたReview/Approvalは、

```text
Security Context 42
```

に対してのみ有効。

Security Contextが重大に変更されたら、

```text
security_epoch = 43
```

へ進める。

---

# 41. Security EpochはRollbackしない

必須Invariant:

```text
security_epoch only increases
```

。

Tierを元に戻してもEpochを過去値へ戻さない。

---

# 42. Security Posture Hash

補助として、

```text
security_posture_hash
```

も保存可能。

対象例:

```text
deployment tier
critical policy version/hash
validator profile trust config
trust anchor digest
```

---

# 43. EpochとHashの役割

```text
security_epoch
→ validity boundary

security_posture_hash
→ diagnostics / audit / exact context identification
```

。

---

# 44. Review Snapshot Binding

Review Snapshotに、

```text
security_epoch
deployment_tier
security_posture_hash
```

を持たせる。

---

# 45. Review Snapshot Example

```json
{
  "reviewDigest": "sha256:...",
  "validatorProfileDigest": "sha256:...",
  "artifactDigest": "sha256:...",

  "deploymentTier": 1,
  "securityEpoch": 42,
  "securityPostureHash": "sha256:..."
}
```

---

# 46. Approval Binding

Approvalも、

```text
review_snapshot_id
review_digest
validator_profile_digest
security_epoch
```

へbindingする。

---

# 47. Git Operation Binding

Git Operationにも、

```text
security_epoch
```

を保存する。

Push直前にCurrent Epochと一致確認。

---

# 48. Epoch Mismatch

```text
operation.security_epoch
!=
instance.security_epoch
```

なら、

```text
STALE_APPROVAL_SECURITY_POSTURE_CHANGED
```

または、

```text
STALE_OPERATION_SECURITY_POSTURE_CHANGED
```

。

Push禁止。

---

# 49. Security Epoch Increment条件

例えば:

```text
Tier downgrade

Critical Git policy relaxation

Validator trust reset

Trust anchor emergency rotation

Credential authority reset

Emergency incident response

Security-critical policy semantics change
```

。

---

# 50. Epoch Increment不要な変更

例:

```text
UI theme
Discord message format
Observability label
Non-security timeout tweak
Documentation change
```

。

何でもEpoch incrementしない。

---

# 51. Policy Changeとの関係

従来の、

```text
policy_hash mismatch
```

も維持可能。

Security Epochはより上位のInvalidate mechanism。

つまり、

```text
specific change
→ policy_hash

global security posture change
→ security_epoch
```

。

---

# 52. Tier Configuration

Deployment Tier:

```text
0
1
2
3
```

。

Config例:

```yaml
security:
  deployment_tier: 1
```

---

# 53. Stored Tier

Configured Tierだけでなく、

```text
stored_deployment_tier
```

をDBへ保持する。

---

# 54. Startup Tier Comparison

```text
configured > stored
→ upgrade flow

configured == stored
→ normal startup

configured < stored
→ downgrade blocked
```

をdefaultとする。

---

# 55. Why Block Silent Downgrade

例えば、

```text
Tier 1
↓
config file edit
↓
Tier 0
```

だけでSecurity Controlsを弱めると、既存Approval/Git OperationのSecurity Assumptionが変化するため。

---

# 56. Tier Downgrade

Tier Downgradeは明示的Admin Operation。

概念例:

```text
rad admin security downgrade --to-tier 0
```

実CLI名称は後で決定してよい。

---

# 57. Downgrade Workflow

Tier 1 → Tier 0例:

```text
1. Enter maintenance mode

2. Stop new workspace creation

3. Stop new approvals

4. Inspect active Git operations

5. Cancel unfinished Git operations

6. Invalidate pending/approved reviews as needed

7. Revoke/expire credential leases where possible

8. Invalidate one-time IDE access codes

9. Handle ACTIVE workspaces

10. Increment security_epoch

11. Update stored deployment tier

12. Write high-severity audit event

13. Exit maintenance mode
```

---

# 58. ACTIVE Workspace Handling

Downgrade時のPolicyを選べる。

推奨default:

```text
Stop or destroy all ACTIVE workspaces
```

。

Optional:

```text
operator explicitly acknowledges continuation
```

。

---

# 59. Why Stop Existing Workspaces

既存Workspaceは、

```text
Tier 1 network assumptions
Tier 1 validation assumptions
Tier 1 policy assumptions
```

の下で作られているため。

Tier 0へ持ち越すとSecurity Contextが曖昧になる。

---

# 60. Pending Review Handling

Downgrade時、

```text
PENDING
APPROVED
```

Review/Approvalは原則STALE化。

---

# 61. Git Operation Handling

状態:

```text
PENDING
VALIDATING
WAITING_CREDENTIAL
```

はcancel。

`PUSHING`中なら結果を確認し、AmbiguousならFail Closed。

---

# 62. Credential Lease Handling

```text
RESERVED
ISSUED
```

Leaseは可能ならrevoke。

Providerで明示revokeができない場合は、

```text
mark invalid locally
+
wait for provider expiration
```

。

---

# 63. Session Handling

Tier downgrade時、

```text
IDE one-time code
web session
admin session
```

のうちSecurity-sensitiveなSessionは再認証を要求可能。

---

# 64. Security Epoch Increment Timing

Downgrade migrationのcritical section中にEpochをincrementする。

推奨:

```text
maintenance mode
↓
invalidate/cancel
↓
security epoch increment
↓
tier update
↓
commit
```

。

---

# 65. Downgrade Failure

Migration途中で失敗した場合、

```text
partial downgrade
```

を成功扱いしない。

InstanceをMaintenance/Degraded stateへ残す。

---

# 66. Downgrade Audit

必須:

```text
SECURITY_TIER_DOWNGRADE_REQUESTED

SECURITY_TIER_DOWNGRADE_STARTED

SECURITY_TIER_DOWNGRADE_BLOCKED

SECURITY_TIER_DOWNGRADE_COMPLETED

SECURITY_EPOCH_INCREMENTED
```

。

---

# 67. Tier Upgrade

UpgradeはDowngradeより安全だが、完全に自動でよいとは限らない。

例えばTier 1 → Tier 2で、

```text
Dedicated Token Issuer
```

を有効にする場合、新しいCredential AuthorityがReadyである必要がある。

---

# 68. Upgrade Workflow

```text
Validate target tier requirements

Provision required components

Run security readiness checks

Increment security_epoch if posture semantics changed

Activate target tier

Audit
```

。

---

# 69. Epoch on Upgrade

UpgradeでもSecurity-sensitive semanticsが変わる場合、Epoch incrementを推奨する。

古いApprovalを新しいSecurity Architectureへ自動持ち越さないことで単純化できる。

---

# 70. Security Posture State

Instance状態例:

```text
NORMAL

MAINTENANCE

MIGRATING_SECURITY_POSTURE

DEGRADED_SECURITY

SECURITY_LOCKDOWN
```

を将来的に持てる。

Tier 1初期実装では簡略化してもよい。

---

# 71. Emergency Security Lockdown

重大Issue発見時:

```text
security lockdown
```

を設定可能にする。

効果例:

```text
Block new workspace
Block approval
Block Git push
Invalidate security-sensitive sessions
Increment epoch
```

。

---

# 72. Security Epoch as Common Invalidation Primitive

これまで個別に、

```text
policy changed
validator changed
tier changed
trust changed
```

を扱っていたが、

重大変更では、

```text
security epoch++
```

を共通mechanismとして使える。

---

# 73. Security Epochを使いすぎない

Epoch incrementは広範囲なApproval invalidationを引き起こすため、

```text
fine-grained hash
```

と併用する。

---

# 74. Validation Pipeline

Coreはv0.8から維持。

```text
Git Bundle
   ↓
Server-side Digest
   ↓
Immutable Artifact
   ↓
Validation Launcher
   ↓
Digest-pinned Validator
   ↓
Networkless Validation
   ↓
Structural Review Manifest
   ↓
CRF
   ↓
Review Digest
```

---

# 75. Validation Launcher — Tier 1

`rad-control`内Moduleでよい。

ただしValidation RunnerはProcess/Container分離する。

---

# 76. Validation Launcher Security Boundary

Launcher自体はTier 1 TCB内。

RunnerはUntrusted Parsing Domain。

```text
rad-control / Launcher
        │ trusted
────────┼──────────
        ▼
Validation Runner
        │ untrusted parser
        │ network none
```

。

---

# 77. Validation Image Pull

Launcherが行う。

順序:

```text
Resolve pinned image
↓
Pull if unavailable
↓
Verify digest
↓
Create container
↓
Disable network
↓
Mount artifact read-only
↓
Run validation
```

。

---

# 78. Exact Validator Matching

```text
approved_validator_profile_digest
==
runtime_validator_profile_digest
```

のみ受理。

---

# 79. Validator Profile Tier 1

Static config。

```yaml
validation:
  profiles:
    default:
      image:
        name: ghcr.io/example/rad-validator
        digest: sha256:...
      crf_version: CRF-1
      git_binary_digest: sha256:...
      canonicalizer_digest: sha256:...
      policy_digest: sha256:...
      runner_config_digest: sha256:...
```

---

# 80. Validator Profile Change

Profile変更は新Digestを生成。

既存Approvalは、

```text
STALE_APPROVAL_VALIDATOR_CHANGED
```

。

必要に応じてSecurity Epochもincrementする。

---

# 81. Canonical Review

Security RootはStructural Manifest。

---

# 82. Structural Manifest Inputs

```text
Repository ID
Workspace ID
Git Object Format
Base Commit
Target Commit
Target Tree
Artifact Digest
Validator Profile Digest
Raw Git Path Identity
Blob IDs
Modes
Status
Policy Hash
Security Epoch
```

。

---

# 83. Security EpochをReview Digestへ含めるか

推奨:

```text
YES
```

。

これによりEpoch変更時、同じGit ObjectでもReview Digestが異なる。

---

# 84. Review Digest

概念:

```text
ReviewDigest =
SHA-256(
  CRF_CanonicalSerialize(
    StructuralManifestIncludingSecurityEpoch
  )
)
```

。

---

# 85. Human Approval

Approval対象:

```text
Immutable Review Snapshot

Review Digest

Validator Profile Digest

Security Epoch
```

。

---

# 86. Final Re-validation

Push前:

```text
Current epoch valid?
↓
Exact validator available?
↓
Artifact immutable?
↓
Networkless validation
↓
Structural manifest
↓
Review digest recompute
↓
Digest equal?
↓
Remote CAS
```

。

---

# 87. Epoch Check Ordering

安価なcheckなので最初に行う。

```text
operation epoch == current epoch?
```

不一致ならArtifact validationを走らせない。

---

# 88. Git Operation

Tier 1では`rad-control`内Module。

Tier 2でDedicated Serviceへ移行。

---

# 89. GitHub Token Issuer

Tier 1ではTrusted Module。

Tier 1 Security Claim:

> Token Issuer Module separation does not protect against compromise of rad-control.

---

# 90. Token Issuer Interface

```ts
interface TokenIssuer {
  issueForOperation(input: {
    operationId: string;
    repositoryId: string;
    permissions: GitPermissions;
    securityEpoch: number;
  }): Promise<EphemeralCredential>;
}
```

---

# 91. Credential Lease

```sql
credential_leases (
    id UUID PRIMARY KEY,

    operation_id UUID NOT NULL UNIQUE,

    repository_id UUID NOT NULL,

    security_epoch BIGINT NOT NULL,

    state TEXT NOT NULL,

    issued_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL
)
```

---

# 92. Lease Epoch Check

Token発行時:

```text
lease.security_epoch
==
instance.security_epoch
```

を要求。

---

# 93. Lease State

```text
RESERVED
ISSUED
CONSUMED
EXPIRED
FAILED
UNCERTAIN
```

。

UNCERTAINから自動再発行しない。

---

# 94. Remote Branch CAS

Git Operationに、

```text
expected_remote_head
```

を保存。

Push直前に一致確認。

---

# 95. Security EpochとCAS

異なる問題を解決する。

```text
Security Epoch
→ local security context race

Remote CAS
→ remote repository state race
```

両方必要。

---

# 96. Git Operation State

```text
PENDING
VALIDATING
WAITING_CREDENTIAL
PUSHING
SUCCEEDED
FAILED
CONFLICT
CANCELLED
STALE
```

。

---

# 97. STALE

以下でSTALE:

```text
Security epoch changed

Validator profile changed

Approval expired

Policy changed

Review snapshot invalidated
```

。

---

# 98. Workspace Security Policy

Tier 1例:

```yaml
workspace:
  sandbox:
    backend: rootless-docker

  network:
    mode: strict

  resources:
    cpu: 4
    memory: 8GiB
    disk: 20GiB
    pids: 512
    ttl: 8h

  git:
    remote_write: trusted-control-only
    protected_branch_push: false
    force_push: false
```

---

# 99. Tier Requirements Registry

各Tierが要求するSecurity ControlsをCodeとして定義する。

例:

```ts
interface TierRequirements {
  workspaceCredentialIsolation: boolean;
  networklessValidation: boolean;
  validatorDigestPinning: boolean;
  serviceSeparatedTokenIssuer: boolean;
  signedValidatorRequired: boolean;
}
```

---

# 100. Tier Validation

Startup時に、

```text
Configured Security Controls
>=
Required Controls for Tier
```

を検証。

---

# 101. Tier ConfigurationをSecurity Policyと混同しない

Tierは、

```text
minimum deployment security posture
```

である。

個々のWorkspace Policyとは別。

---

# 102. Tier 1 Default Network

```text
strict
```

。

Tier 0なら`standard`等を許可可能。

ただしTier downgrade migrationなしに変更しない。

---

# 103. Tier-sensitive Config

以下はTier Constraint対象。

```text
Validation networking
Workspace credential injection
Sandbox privilege
Protected branch push
Validator pinning
Token authority placement
Trust anchor requirement
```

。

---

# 104. Non-tier-sensitive Config

例:

```text
UI pagination
Discord message verbosity
Default workspace name
Log presentation
```

。

---

# 105. Maintenance Mode

Security migration時に必要。

```text
maintenance_mode = true
```

。

効果:

```text
Reject workspace creation
Reject new task
Reject new approval
Reject Git operation start
```

。

---

# 106. Maintenance Mode中のRead

Review閲覧やAudit閲覧は許可可能。

---

# 107. Security Posture Migration Lock

Tier migrationを同時に複数走らせない。

DB advisory lock等を利用。

---

# 108. Migration State Table

必要なら:

```sql
security_migrations (
    id UUID PRIMARY KEY,

    from_tier INTEGER NOT NULL,
    to_tier INTEGER NOT NULL,

    from_epoch BIGINT NOT NULL,
    target_epoch BIGINT NOT NULL,

    state TEXT NOT NULL,

    initiated_by UUID NOT NULL,

    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ
)
```

Tier 1初期では必須ではない。

---

# 109. Security Migration States

```text
REQUESTED
PREPARING
DRAINING
INVALIDATING
COMMITTING
COMPLETED
FAILED
```

。

---

# 110. Simple Tier 1 Implementation

初期版では複雑なMigration Tableを作らず、

```text
admin command
+
maintenance mode
+
single DB transaction where possible
+
audit event
```

でもよい。

---

# 111. Security Epoch API

一般Userには変更させない。

Admin-only。

---

# 112. Security Epochは手動設定禁止

```text
set epoch = 5
```

のような任意設定ではなく、

```text
increment
```

のみ。

---

# 113. Security Epoch Overflow

BIGINTを利用。

実運用上問題にならない。

---

# 114. Security Posture Hash Calculation

Canonical representationを利用可能。

例:

```text
SHA-256(
  canonical(
    tier,
    critical policy hash,
    validator trust hash,
    trust anchor hash
  )
)
```

。

---

# 115. Security Epoch Audit

```text
SECURITY_EPOCH_INCREMENT_REQUESTED

SECURITY_EPOCH_INCREMENTED

SECURITY_POSTURE_CHANGED
```

を記録。

---

# 116. Approval Staleness Reasons

```text
APPROVAL_EXPIRED

STALE_APPROVAL_ARTIFACT_CHANGED

STALE_APPROVAL_POLICY_CHANGED

STALE_APPROVAL_VALIDATOR_CHANGED

STALE_APPROVAL_SECURITY_POSTURE_CHANGED

STALE_APPROVAL_REMOTE_STATE_CHANGED
```

。

---

# 117. Why Explicit Reason Codes

運用時、

```text
Review mismatch
```

と、

```text
Tier changed
```

を区別できる。

前者はIncident候補。

後者は通常Operation。

---

# 118. Deployment Tier Downgrade Policy

`DEPLOYMENT_TIERS.md`へ必ず記載する。

---

# 119. Downgrade Default Rule

> A lower deployment tier SHALL NOT inherit security-sensitive approvals or active Git operations from a higher tier without explicit migration.

---

# 120. Downgrade and Workspace

Default:

```text
active workspace → stop/destroy
```

。

将来operator overrideを入れるならHigh-severity warning必須。

---

# 121. Downgrade and Artifact

Immutable Artifact自体は保存してもよい。

Artifact bytesはSecurity Contextではないため。

ただしReview/ApprovalはStale。

---

# 122. Downgrade and Review Snapshot

Review Snapshotを削除する必要はない。

Audit/History用に保持。

StateをSTALE化。

---

# 123. Downgrade and Audit

過去のSecurity Contextを失わないよう、

```text
security_epoch
deployment_tier
security_posture_hash
```

をAudit Eventへ記録する。

---

# 124. Tier Upgrade and Existing Approval

最も単純なDefault:

```text
upgrade → epoch increment → old approvals stale
```

。

Availabilityより設計単純性を優先。

---

# 125. Tier Migration UX

Admin UI例:

```text
Security Tier Change

Current: Tier 1
Target:  Tier 0

This will:

• Stop 3 active workspaces
• Invalidate 2 approved reviews
• Cancel 1 pending Git operation
• Expire 1 credential lease
• Increment the security epoch

[Cancel]
[Proceed with downgrade]
```

。

---

# 126. Confirmation

Tier downgradeは明示的確認を要求する。

APIの単一Config POSTだけで降格させない。

---

# 127. Tier Upgrade UX

```text
Tier 1 → Tier 2

Missing requirements:
✗ Dedicated Token Issuer
✓ gVisor available
✓ Service identity configured
```

等を表示できる。

---

# 128. Security Readiness Check

各Tierへ、

```text
rad security check --tier 2
```

のようなdiagnostic commandを将来的に用意するとよい。

---

# 129. Release Architecture

Tier 1:

```text
Reverse Proxy

rad-control

PostgreSQL

Workspace Containers

Validation Containers

Optional Redis
```

。

---

# 130. rad-control内部構造

```text
rad-control
│
├─ api/
├─ discord/
├─ auth/
├─ policy/
├─ workspace/
│   ├─ coordinator
│   ├─ supervisor
│   └─ reconciler
├─ review/
├─ validation/
├─ git/
│   ├─ operations
│   └─ token-issuer
├─ security-posture/
└─ audit/
```

---

# 131. Dependency Direction

例えば:

```text
API
 ↓
Application Services
 ↓
Domain Modules
 ↓
Infrastructure Adapters
```

GitHub SDK等を任意Moduleから直接呼ばせない。

---

# 132. Token Issuer Import Restriction

TypeScript monorepoなら、

```text
packages/github-token-issuer
```

をprivate internal packageにして、

```text
GitOperationModule
```

以外からのimportをlint ruleで禁止可能。

ただしこれはLogical Constraintにすぎない。

---

# 133. Why Still Useful

Process Boundaryでなくても、

```text
accidental dependency
future refactoring
security review
code ownership
auditability
```

に効果がある。

---

# 134. Process Extraction Trigger

以下が発生したらModuleをServiceへ切り出す。

```text
Multiple untrusted users

Credential blast-radius concern

Independent network policy required

Different secret authority required

Independent scaling

External compliance/security requirement
```

。

---

# 135. Transactional Outbox Roadmap

Milestone 0:

```text
desired/observed + sync calls
```

Milestone 1〜3:

```text
reconciler improvements
```

Milestone 4:

```text
outbox prototype
```

Tier 2:

```text
durable command processing recommended
```

。

---

# 136. Outbox Data Model

将来:

```sql
outbox_commands (
    id UUID PRIMARY KEY,

    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,

    command_type TEXT NOT NULL,
    payload JSONB NOT NULL,

    state TEXT NOT NULL,

    attempts INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ
)
```

---

# 137. Outbox Security

Outbox payloadにSecretを入れない。

IDs/intentのみ。

---

# 138. Workspace Commands

```text
PROVISION
START
SUSPEND
STOP
DESTROY
```

等。

---

# 139. Reconciler Remains

Outbox導入後もReconcilerは必要。

Outboxはcommand delivery。

Reconcilerはstate convergence。

役割が異なる。

---

# 140. CRF

引き続きTier 1 Core。

---

# 141. Canonicalization Pipeline

```text
Collect
↓
Sort
↓
Encode
↓
Hash
```

。

---

# 142. Security Epoch in CRF

CRF-1仕様に入れるならVersion Freeze前に決める。

まだCRF-1未実装なら、

```text
securityEpoch
```

をStructural Manifestへ含める。

---

# 143. CRF Migration

既にCRF-1を固定後にSecurity Epochを追加するなら、

```text
CRF-2
```

が必要。

Format Semanticsをsilent changeしない。

---

# 144. v0.9推奨

まだ実装前なので、

```text
CRF-1 includes securityEpoch
```

として開始するのが簡単。

---

# 145. Review Snapshot Example v0.9

```json
{
  "crfVersion": "CRF-1",

  "repositoryId": "repo_123",
  "workspaceId": "ws_456",

  "baseCommit": "...",
  "targetCommit": "...",
  "targetTree": "...",

  "artifactDigest": "sha256:...",
  "validatorProfileDigest": "sha256:...",

  "securityEpoch": 42,
  "deploymentTier": 1,

  "files": []
}
```

---

# 146. Review Digest Reproduction

Final Re-validationには同じ、

```text
Artifact
Validator Profile
Security Epoch
Policy
```

が必要。

---

# 147. Security Epoch Change Mid-Validation

Validation中にEpochが変わる可能性を考慮。

開始時:

```text
epoch = 42
```

終了時再check:

```text
current epoch == 42?
```

不一致なら結果破棄。

---

# 148. Approval Race with Epoch Change

Approve transaction内で、

```text
approval.security_epoch == current security_epoch
```

を確認。

Epoch changeとのRaceを防ぐ。

---

# 149. Git Push Race with Epoch Change

Token発行直前、Push直前にも必要に応じてEpoch確認。

Security-sensitive pipelineが長い場合は複数checkしてよい。

---

# 150. Epoch Snapshot

Operation開始時に、

```text
operation_epoch
```

を固定。

途中でCurrent Epochが変わったらcancel/stale。

---

# 151. Security Migration LockとGit Operation

Security Migration開始時に新しいGit Operationを止める。

Existing Operationはdrainまたはcancel。

---

# 152. Drain vs Cancel

Default:

```text
not yet credential-issued
→ cancel

already pushing
→ await bounded completion / verify outcome
```

。

---

# 153. Token Issuance Ambiguity During Migration

状態不明なら、

```text
UNCERTAIN
```

。

再発行しない。

---

# 154. Audit Context

すべてのCritical Eventに可能な範囲で、

```text
workspace_id

operation_id

review_snapshot_id

security_epoch

deployment_tier

policy_hash

validator_profile_digest
```

を付与。

---

# 155. Trace Context

Correlation Chain:

```text
Discord Interaction
 ↓
Workspace
 ↓
Task
 ↓
Artifact
 ↓
Review
 ↓
Approval
 ↓
Git Operation
 ↓
Credential Lease
```

。

---

# 156. Security Metrics

追加:

```text
security_epoch_total

security_posture_change_total

tier_upgrade_total

tier_downgrade_total

stale_approval_security_posture_total

security_migration_failure_total
```

。

---

# 157. Alert Candidates

```text
Unexpected tier downgrade

Repeated security epoch increments

Git operation attempted with stale epoch

Credential issuance during maintenance mode

Tier requirement validation failure
```

。

---

# 158. Production Startup Checks

```text
APP_ENV valid

Tier config valid

Stored tier compatible

Security posture consistent

Validator digest configured

Validation network disabled

Workspace credential isolation enabled

Protected branch push disabled
```

。

---

# 159. Startup on Silent Downgrade

```text
configured_tier < stored_tier
```

なら:

```text
STARTUP BLOCKED
```

。

ログ:

```text
Explicit security downgrade migration required.
```

。

---

# 160. Startup on Upgrade

Target Tier requirementsを満たすまで起動拒否または旧Tierで起動。

Silent partial upgradeは避ける。

---

# 161. Recommended Upgrade Behavior

安全側に、

```text
configured_tier > stored_tier
→ migration required
```

としてもよい。

単純化できる。

---

# 162. Security Migration Command

Conceptual:

```text
rad security migrate --to-tier 2
```

。

内部でReadiness Checkを行う。

---

# 163. Security Posture Diff

Migration前に、

```text
Current:
Tier 1
Validator digest A
Policy hash P1

Target:
Tier 2
Dedicated Token Issuer
Validator digest A
Policy hash P2
```

等を表示できるとよい。

---

# 164. Tier 1 Threat Model

```text
Malicious Repository

Compromised Agent

Dependency compromise

Build-script RCE

Prompt injection

Malicious Git Artifact

Git parser compromise

Workspace URL leak

SSRF

Workspace escape attempt

Approval replay

Review/push mismatch

Remote branch race

Misconfiguration
```

。

---

# 165. Tier 1 Out-of-Scope Threats

```text
Host root compromise

rad-control process full compromise

PostgreSQL administrator compromise

GitHub App key storage compromise by host root
```

。

明示する。

---

# 166. Tier 2 Purpose

Tier 1 Out-of-Scopeの一部を縮小する。

特に、

```text
rad-control compromise
```

のCredential Blast Radiusを減らす。

---

# 167. Tier 2 Separation

```text
rad-control
 ↓
Git Operation Service
 ↓
Token Issuer
```

。

さらにService Identity/Network ACL。

---

# 168. Tier 3 Purpose

Supply Chain / hostile tenant / host separationをさらに強化。

---

# 169. Git Integrity Chain v0.9

```text
Workspace Local Commit
        ↓
Git Bundle
        ↓
Server-side Artifact Digest
        ↓
Immutable Artifact
        ↓
Security Epoch Snapshot
        ↓
Exact Validator Profile
        ↓
Networkless Validation
        ↓
Structural Manifest
        ↓
CRF
        ↓
Review Digest
        ↓
Human Review
        ↓
Approval bound to Epoch
        ↓
Current Epoch Check
        ↓
Exact Re-validation
        ↓
Review Digest Equality
        ↓
Current Epoch Check
        ↓
Remote Branch CAS
        ↓
Credential Lease
        ↓
Current Epoch Check
        ↓
GitHub Push
```

---

# 170. Why Multiple Epoch Checks

Security PostureがOperation途中で変化しても、古いAuthorityでSide Effectを継続しないため。

---

# 171. Epoch Check Cost

DB read程度なので安価。

必要ならInstance postureをcacheしつつGeneration更新を購読する。

初期はDB readでよい。

---

# 172. Review UX

Tier 1では、

```text
Files Changed
Diff
Binary changes
Mode changes
Tests
Review Digest
Security Tier
```

等を表示可能。

---

# 173. Security Context Display

必要ならReview UIに、

```text
Security Tier: 1
Validator: rad-validator-v1
Security Epoch: 42
```

を折りたたみ表示。

一般Userには詳細を隠してもよい。

---

# 174. Stale Review UX

```text
This review can no longer be approved.

Reason:
Security posture changed after this review was created.

A new review must be generated.
```

と明確にする。

---

# 175. Tier Downgrade UX Warning

Critical Warning。

単なるSettings toggleにしない。

---

# 176. README Security Tier Description

Tier 1:

```text
Tier 1 assumes the host operating system and the rad-control process
are trusted.

Module boundaries inside rad-control are logical architecture
boundaries and do not provide isolation against compromise of the
rad-control process.
```

の趣旨を記載。

---

# 177. DEPLOYMENT_TIERS.md

最低限:

```text
Tier definitions

Threat assumptions

Required controls

Upgrade procedure

Downgrade procedure

Security epoch behavior

Existing workspace behavior

Approval invalidation

Credential handling
```

。

---

# 178. SECURITY.md

```text
Trusted Computing Base

Untrusted components

Tier assumptions

Known limitations

rad-control compromise implications

Validator trust

Git credential model

Security posture changes
```

を明記。

---

# 179. OPERATIONS.md

v0.9で新設推奨。

```text
Workspace recovery

Reconciler behavior

Tier migration

Maintenance mode

Security epoch rotation

Incident lockdown

Backup/restore
```

。

---

# 180. Backup Consideration

DB Backupから復旧した際、

```text
security_epoch rollback
```

が起き得る。

重要な将来課題。

---

# 181. Restore Epoch Safety

Backup Restore時、現在より古いEpochへ戻すとApproval replay riskがある。

初期運用では、

> restore後はsecurity_epochを強制incrementする

ことを推奨。

---

# 182. Restore Procedure

概念:

```text
Restore DB
↓
Maintenance mode
↓
Invalidate active sessions/operations
↓
Increment security_epoch
↓
Reconcile workspaces
↓
Resume
```

。

---

# 183. Backup Scope

Credential Token本体はDB保存しないためBackupへ含まれない。

良い性質。

---

# 184. Clock Consideration

Approval expiry等はwall-clock依存。

NTP大幅変動等の扱いは将来Hardening。

Security Epochはclock-independent。

---

# 185. Instance Identity

将来、

```text
instance_id
```

もReview/Operationへbindingすると、DB cloneした別InstanceでのReplayを防ぎやすい。

---

# 186. v0.9でのScope

`instance_id`はOptional future enhancement。

CoreはSecurity Epochまで。

---

# 187. Core Database Tables v0.9

```text
instance_metadata

users
identities
repositories

workspaces
workspace_policies

agent_sessions
agent_tasks

git_artifacts

review_snapshots
approval_requests

git_operations
credential_leases

audit_events
```

。

---

# 188. review_snapshots v0.9

```sql
review_snapshots (
    id UUID PRIMARY KEY,

    workspace_id UUID NOT NULL,
    repository_id UUID NOT NULL,
    artifact_id UUID NOT NULL,

    crf_version TEXT NOT NULL,

    base_commit TEXT NOT NULL,
    target_commit TEXT NOT NULL,
    target_tree TEXT NOT NULL,

    artifact_digest TEXT NOT NULL,
    validator_profile_digest TEXT NOT NULL,

    security_epoch BIGINT NOT NULL,
    deployment_tier INTEGER NOT NULL,
    security_posture_hash TEXT NOT NULL,

    review_digest TEXT NOT NULL,

    policy_hash TEXT NOT NULL,

    structural_manifest JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL
)
```

---

# 189. approval_requests v0.9

```sql
approval_requests (
    id UUID PRIMARY KEY,

    workspace_id UUID NOT NULL,
    review_snapshot_id UUID NOT NULL,

    operation_type TEXT NOT NULL,

    review_digest TEXT NOT NULL,

    security_epoch BIGINT NOT NULL,

    status TEXT NOT NULL,

    requested_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,

    decided_by UUID,
    decided_at TIMESTAMPTZ
)
```

---

# 190. git_operations v0.9

```sql
git_operations (
    id UUID PRIMARY KEY,

    workspace_id UUID NOT NULL,
    repository_id UUID NOT NULL,

    review_snapshot_id UUID NOT NULL,
    approval_id UUID NOT NULL,

    branch_name TEXT NOT NULL,
    target_commit TEXT NOT NULL,
    expected_remote_head TEXT,

    security_epoch BIGINT NOT NULL,

    state TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
)
```

---

# 191. Approval Atomicity

Approve時:

```text
BEGIN

lock approval

check status == PENDING

check expires_at

check approval.security_epoch == current epoch

check review valid

UPDATE APPROVED

COMMIT
```

。

---

# 192. Git Operation Start Atomicity

```text
check approval approved

check review digest

check security epoch

create operation
```

をTransaction内で可能な限りまとめる。

---

# 193. Tier Downgrade Atomicity

Docker stop等の外部Side Effectがあるため完全Atomicではない。

Maintenance + Reconciliationで扱う。

---

# 194. Security Migration Reconciler

将来的にはMigration Stateを見て再開可能にする。

Tier 1ではmanual recoveryでもよい。

---

# 195. P0 Implementation Priority

```text
Workspace lifecycle

Desired/Observed state

Idempotent sandbox methods

Codex integration

No GitHub credential in workspace

Resource isolation
```

。

Outboxは含めない。

---

# 196. P1

```text
Git Artifact

Server digest

Networkless validation

CRF

Review Snapshot
```

。

---

# 197. P2

```text
Security Epoch

Approval

Exact Revalidation

Remote CAS

GitHub App push

Credential Lease
```

Security EpochはApproval実装時までに必要。

---

# 198. P3

```text
One-time IDE

Better egress

Audit improvements

Policy algebra

Security tier startup validation
```

。

---

# 199. P4

```text
Transactional Outbox

Review coverage

gVisor

Abuse detector

Tier migration tooling
```

Tier downgrade supportが必要になれば前倒し可能。

---

# 200. P5

```text
Dedicated Git Operation Service

Dedicated Token Issuer

Validator signatures

Trust Anchor

Profile Registry

KMS/HSM

Firecracker
```

。

---

# 201. First Vertical Slice

```text
Discord
↓
Workspace
↓
Codex
↓
Task
↓
IDE
```

。

Lifecycleはsync + Reconciler。

---

# 202. Second Vertical Slice

```text
Commit
↓
Bundle
↓
Server digest
↓
Networkless validation
↓
CRF Review
```

。

---

# 203. Third Vertical Slice

```text
Review
↓
Approval
↓
Security Epoch Check
↓
Exact Revalidation
↓
Remote CAS
↓
Short-lived GitHub credential
↓
PR
```

。

ここまででInitial OSS Release候補。

---

# 204. Fourth Vertical Slice

```text
Tier migration
Security posture
Improved audit
Outbox
Review coverage
```

。

---

# 205. Security Gate A

Workspace isolation。

```text
No Docker socket

No host secrets

No Control Plane access

Resource limits
```

。

---

# 206. Security Gate B

Review integrity。

```text
Server artifact digest

Networkless validator

Deterministic CRF

Exact validator profile

Immutable review
```

。

---

# 207. Security Gate C

Git write。

```text
Approval epoch check

Final revalidation

Remote CAS

Short-lived token

Protected branch block
```

。

---

# 208. Security Gate D

Operational posture。

```text
Silent tier downgrade blocked

Security epoch increments

Stale approvals rejected

Maintenance mode

Restore procedure
```

。

---

# 209. Security Gate E

High Assurance。

```text
Service separation

Validator signing

Trust anchor

Supply-chain governance
```

。

---

# 210. Testing — Module Boundary

Tier 1では、

```text
Forbidden imports

Forbidden direct GitHub SDK usage

Token Issuer caller tests

Dependency graph checks
```

をCIへ入れる。

---

# 211. Important Limitation

これらのCI checksは、

```text
rad-control RCE
```

に対するSecurity Barrierではない。

Documentationで明示。

---

# 212. Testing — Desired/Observed

```text
Docker create succeeds / DB update fails

DB desired update succeeds / Docker create fails

Process restart during STARTING

Destroy called twice

Missing container while desired RUNNING
```

。

Reconcilerが収束できることを確認。

---

# 213. Testing — Security Epoch

```text
approval created at epoch 42

epoch becomes 43

approve denied

existing approved operation denied

credential lease request denied
```

。

---

# 214. Testing — Tier Downgrade

```text
stored tier 1
configured tier 0
→ startup blocked

explicit migration
→ active workspaces handled
→ approvals stale
→ epoch increment
→ stored tier 0
```

。

---

# 215. Testing — Tier Upgrade

Required security controls不足ならupgrade拒否。

---

# 216. Testing — Backup Restore

将来:

```text
restore old DB
→ old epoch detected/assumed unsafe
→ forced epoch increment
```

。

---

# 217. Security Posture Threat

攻撃者がTier Configだけを書き換える。

防御:

```text
stored tier
startup comparison
explicit migration
```

。

---

# 218. Security Epoch Threat

攻撃者がDB admin権限を持つ場合Epochも改ざん可能。

Tier 1ではDB/HostはTCB。

Tier 3ではexternal monotonic store等を検討可能だがCore外。

---

# 219. Threat: rad-control Compromise

Tier 1では重大。

可能影響:

```text
Issue GitHub token

Modify approvals

Modify security epoch

Modify validator config

Control containers
```

。

Tier 1 Security Model上はTCB compromise。

---

# 220. Tier 2 Mitigation

```text
Token Issuer external

Git Operation Service external

Service identity

Network policy

Separate secrets
```

でBlast Radius縮小。

---

# 221. Threat: Silent Security Downgrade

攻撃/運用ミス:

```text
Tier 1 config
↓
Tier 0
↓
restart
```

。

防御:

```text
stored tier comparison
explicit migration required
```

。

---

# 222. Threat: Approval Replay Across Security Context

防御:

```text
security_epoch binding
```

。

---

# 223. Threat: Restore Replay

古いBackupから古いApproval復活。

防御:

```text
restore procedure forces security epoch increment
```

。

---

# 224. Security Posture as Versioned State

重要な考え方:

> Security configuration is not merely configuration; it is versioned operational state.

---

# 225. Tier as Minimum Security Contract

TierはUI Labelではない。

Tier 1を名乗るInstanceはTier 1 Core Requirementsを満たす必要がある。

---

# 226. Tier Downgrade as Contract Change

そのためDowngradeは、

```text
security contract migration
```

である。

---

# 227. Core vs Operational Hardening

v0.9では新しい巨大Serviceを増やさない。

主に、

```text
Boundaries
State
Migration
Validity
```

を厳密化する。

---

# 228. Monolith-first Principle

継続。

> Modular Monolith First, Strong Isolation Where It Matters.

Strong isolation対象:

```text
Workspace
Validation Runner
```

。

High-value credential authorityはTier 2で分離。

---

# 229. Complexity Budget

新Component追加時:

```text
What threat?

Which tier?

Can current module enforce it?

Is process isolation required?

Operational cost?

Can it wait without breaking Core Invariants?
```

。

---

# 230. No Premature Microservices

Tier 1では、

```text
Git Operation
Token Issuance
Policy
Approval
Review
```

を全部Service分離しない。

---

# 231. No Premature Outbox

Vertical Slice完成前にOutbox infrastructureへ過剰投資しない。

---

# 232. No Silent Security Simplification

一方、以下は「MVPだから」で削らない。

```text
No GitHub token in workspace

Networkless validation

Server artifact digest

CRF

Immutable Review

Exact Revalidation

Remote CAS

Fail Closed
```

。

---

# 233. Recommended Physical Deployment — Tier 1

```text
Reverse Proxy
     ↓
rad-control
     ├─ PostgreSQL
     ├─ GitHub
     ├─ Container Runtime
     │    ├─ Workspace A
     │    ├─ Workspace B
     │    └─ Validation Containers
     └─ Optional Redis
```

。

---

# 234. Host Network Segmentation

可能ならWorkspace networkとControl networkを分離。

Validation networkはnone。

---

# 235. Tier 1 Secret Storage

```text
Docker secret
strict-permission file
environment injection into rad-control only
```

。

Workspaceへinheritさせない。

---

# 236. Environment Sanitization

Workspace/Validator起動時、Host/rad-control environmentをそのままinheritしない。

Allowlisted environmentのみ。

---

# 237. Validation Environment

```text
PATH
LANG fixed
HOME temporary
Git config controlled
No credential helper
No proxy credentials
No SSH agent
```

。

---

# 238. Git Push Execution Environment

Workspace外のtrusted temporary environment。

TokenはそのGit child processのみに最小限渡す。

---

# 239. Push Child Environment

禁止:

```text
General shell inheritance
Unexpected credential helper
Global Git config
User hooks
```

。

---

# 240. Git Config

Trusted service側でremote URL/refspecを構築。

Workspace `.git/config`をAuthorityにしない。

---

# 241. Security Epoch and Config Reload

Security-critical config hot reloadは慎重に扱う。

Critical field変更ならEpoch incrementが必要。

---

# 242. Initial Implementation Simplification

Tier 1最初期ではSecurity-critical configのhot reload自体を禁止し、

```text
restart + migration
```

に限定してもよい。

単純で安全。

---

# 243. Deployment Tier Runtime Change

Settings UIのToggleでは変更させない。

Admin migration operationのみ。

---

# 244. Review Coverage

引き続きOptional enhancement。

Security Epochとは無関係。

---

# 245. Abuse Detection

Tier 2以降推奨。

Tier 1はquota/TTL優先。

---

# 246. Audit Levels

Tier 1:

```text
Structured local/DB audit
```

Tier 2:

```text
Central audit
```

Tier 3:

```text
Append-only remote audit
```

。

---

# 247. Audit Immutability Claim

Tier 1 DB AuditはHost/adminから改変不能とは主張しない。

TCB内だから。

---

# 248. Security Claims must match Tier

READMEで過大主張しない。

---

# 249. Tier 1 Claim

推奨表現:

> Tier 1 is intended for personal and small-team self-hosting under a trusted-host and trusted-control-plane assumption, while treating agent workspaces and Git artifacts as untrusted.

---

# 250. Tier 2 Claim

> Tier 2 reduces the blast radius of control-plane compromise through stronger service and credential separation and is intended for multi-user organizational deployments.

---

# 251. Tier 3 Claim

> Tier 3 adds high-assurance sandboxing and software-supply-chain controls for deployments that may process hostile users or workloads.

---

# 252. Non-goals

初期:

```text
Protection from malicious host root

Formal verification

Perfect sandbox escape prevention

Kubernetes-first deployment

Enterprise CI replacement

Universal Git provider
```

。

---

# 253. Initial OSS Success Criteria

```text
Discord task

Ephemeral workspace

Codex

Web IDE

Local commit

Git artifact

Networkless validation

Canonical review

Approval

Security epoch check

Exact revalidation

Remote CAS

GitHub PR

Workspace destruction
```

。

---

# 254. Initial Security Success Criteria

```text
No Docker socket in workspace

No GitHub write credential in workspace

Workspace cannot reach control network

Validation has no network

Artifact tampering invalidates review

Validator change invalidates review

Epoch change invalidates approval

Remote head conflict blocks push

Protected branch direct push blocked
```

。

---

# 255. Security Posture Operational Rule

> A security-sensitive artifact, review, approval or Git operation is valid only within the security posture under which it was created.

Security Epochがこれを実装する。

---

# 256. Fundamental State Rule

> Desired state describes intent. Observed state describes reality. Neither should be silently substituted for the other.

---

# 257. Fundamental Privilege Rule

> A module boundary improves architecture; only an enforced isolation boundary limits compromise.

---

# 258. Fundamental Tier Rule

> A deployment tier is a security contract, not a cosmetic configuration preset.

---

# 259. Fundamental Migration Rule

> Security posture may be strengthened or weakened only through explicit migration; security-sensitive state must not silently cross posture boundaries.

---

# 260. v0.9 Final Core Security Invariants

```text
1. WorkspaceはUntrustedである。

2. Repository/Agent/DependencyもUntrustedである。

3. WorkspaceへGitHub write credentialを渡さない。

4. WorkspaceへDocker socketを渡さない。

5. WorkspaceからControl Planeへ到達できない。

6. Git Artifact Identityはserver-side digestで決定する。

7. Artifact validationはnetworkless environmentで行う。

8. Human Approvalはimmutable Structural Reviewへbindする。

9. Validator Profileはdigest-pinnedである。

10. Final re-validationはexact profile matchのみ受理する。

11. Review/Approval/Git OperationはSecurity Epochへbindingする。

12. Security Epochはmonotonicである。

13. Security Epoch mismatch時、Git writeを許可しない。

14. Deployment Tierのsilent downgradeは禁止する。

15. Tier downgradeはexplicit security migrationである。

16. Tier downgrade時、旧Security ContextのApprovalを持ち越さない。

17. Workspace lifecycleはDesired/Observed Stateを分離する。

18. Sandbox lifecycle operationはidempotentにする。

19. Transactional OutboxはCore MVPの成立条件ではない。

20. Tier 1ではrad-control全体がTrusted Computing Baseである。

21. Tier 1のIn-process Module BoundaryはSecurity Boundaryではない。

22. Process/credential/network isolationのみがcompromise containmentを提供する。

23. Remote branch CASなしでpushしない。

24. Protected branch direct pushはdefault deny。

25. Credential issuance uncertaintyではFail Closedする。

26. Security-sensitive ambiguityは成功扱いしない。
```

---

# 261. v0.9 Recommended Development Order

```text
1. Workspace Lifecycle
   ├─ Desired/Observed
   ├─ Idempotent supervisor
   └─ Reconciler

2. Agent Runtime
   ├─ Codex
   └─ IDE

3. Artifact Integrity
   ├─ git bundle
   ├─ staging
   └─ server digest

4. Review Integrity
   ├─ networkless validator
   ├─ CRF
   └─ immutable review

5. Security Context
   ├─ deployment tier
   └─ security epoch

6. Secure Git Write
   ├─ approval
   ├─ exact revalidation
   ├─ CAS
   ├─ short-lived credential
   └─ PR

7. Operational Hardening
   ├─ tier migration
   ├─ outbox
   ├─ better audit
   └─ review coverage

8. Advanced Hardening
   ├─ service separation
   ├─ validator signing
   ├─ trust anchors
   ├─ gVisor
   ├─ KMS/HSM
   └─ Firecracker
```

---

# 262. Tier 1 Final Architecture

```text
                      User
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
          Discord              Web
             │                   │
             └─────────┬─────────┘
                       ▼
                 ┌───────────┐
                 │rad-control│
                 │           │
                 │ Auth      │
                 │ Policy    │
                 │ State     │
                 │ Review    │
                 │ Approval  │
                 │ Git       │
                 │ Token     │
                 │ Security  │
                 │ Posture   │
                 └─────┬─────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
   PostgreSQL      Container         GitHub
                    Runtime
                       │
              ┌────────┴────────┐
              ▼                 ▼
          Workspace         Validation
          Container         Container
                              │
                         NETWORK NONE
```

---

# 263. Tier 2 Evolution

```text
rad-control
    │
    ├── Workspace Supervisor
    │
    ├── Git Operation Service
    │       │
    │       ▼
    │   Token Issuer
    │
    └── Validation Launcher
```

権限をProcess境界で分離。

---

# 264. Tier 3 Evolution

```text
Control Plane
      │
      ├── Workspace Domain
      ├── Validation Launcher
      │      ↓
      │   Signed Validator
      │
      ├── Git Operation Domain
      │      ↓
      │   Token Issuer
      │
      └── Validator Trust Domain
             ↓
         Profile Registry
         Trust Anchors
```

。

---

# 265. 最終Security Model

v0.9では、

```text
AIを信用しない

Repositoryを信用しない

Workspaceを信用しない

Git Artifactを信用しない

Git Parserを信用しない
```

という基本思想に加え、

```text
Security Configurationも単なる静的Configとして信用しない
```

という運用上の考え方を追加する。

Security-sensitive Contextは、

```text
Versioned Security Posture
```

として扱う。

---

# 266. 結論

Remote Agent Devbox v0.9では、新しい大規模Subsystemを増やすのではなく、v0.8の実装可能性を維持したまま、

```text
誰をTrusted Computing Baseとするか

何が本当のSecurity Boundaryなのか

Workspace Lifecycle Stateをどう現実と同期するか

Security Tier変更時に既存Approvalをどう扱うか

Security Context変更をどう全体へ伝播させるか
```

を厳密化した。

Tier 1では、

```text
rad-control
```

を単一のTrusted Computing Baseとして認める。

その内部Module分離はArchitecture上重要だが、

```text
RCE containment
```

を提供するとは主張しない。

Workspace Lifecycleについては、

```text
Desired State
+
Observed State
+
Idempotent Operations
+
Reconciler
```

を初期段階から採用する一方、

```text
Transactional Outbox
```

は実際に必要になるMilestoneまで後回しにする。

さらに、

```text
Security Epoch
```

を導入し、

```text
Tier変更
Critical Policy変更
Validator Trust変更
Emergency Security Reset
```

等を共通のSecurity Context変更として扱う。

その結果、

```text
Old Approval
+
New Security Posture
```

が暗黙に混在することを防げる。

v0.9のChain of Trustは最終的に、

```text
Untrusted Workspace
       ↓
Server-owned Artifact Identity
       ↓
Networkless Validation
       ↓
Canonical Structural Review
       ↓
Security Epoch Binding
       ↓
Human Approval
       ↓
Current Posture Validation
       ↓
Exact Validator Re-validation
       ↓
Remote Repository CAS
       ↓
Short-lived Credential
       ↓
GitHub
```

となる。

そしてProject Architectureそのものは、

> **最初はModular Monolithとして完成させ、WorkspaceとParserだけを強く隔離し、ユーザー数・Credential Risk・Threat Modelが拡大した段階でHigh-value AuthorityをProcess Boundaryへ切り出す**

方針を維持する。

これによりRemote Agent Devboxは、

> **個人でも実際に完成させられる複雑度を維持しながら、Agent・Repository・Git Artifactを信用せず、人間が承認した変更だけをGitHubへ安全に反映し、そのSecurity Posture自体の変更まで明示的・追跡可能に管理できるSecure Self-hosted Agent Development Runtime**

を目標とする。
