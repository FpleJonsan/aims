# Distinct, least-privilege roles per service — both the task execution role
# (what the ECS agent may do on the task's behalf: pull image, write logs,
# read secrets) and the task role (what the running container may call in
# AWS). No IAM user or static access key is created anywhere.
#
# FIX (found in review): the first draft used ONE shared execution
# role whose secrets policy granted `secretsmanager:GetSecretValue` on all 7
# secrets to every task — meaning the web/clamav tasks' execution role could
# read the Keycloak admin password and every database URL even though
# neither task needs any secret at all. Replaced with 5 distinct execution
# roles, each scoped only to the secrets its own task definition actually
# references.

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

locals {
  # Which Secrets Manager entries each service's execution role may read —
  # must stay in sync with the `secrets` block of that service's container
  # definition in ecs-services.tf.
  execution_role_secrets = {
    api      = ["DATABASE_URL", "FINANCE_DATABASE_URL", "PAYMENT_DATABASE_URL", "OIDC_CLIENT_SECRET"]
    worker   = ["DOCUMENT_WORKER_DATABASE_URL"]
    web      = []
    keycloak = ["KEYCLOAK_DB_URL", "KEYCLOAK_ADMIN_PASSWORD"]
    clamav   = []
  }
}

resource "aws_iam_role" "execution" {
  for_each           = local.execution_role_secrets
  name               = "aims-staging-${each.key}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  for_each   = local.execution_role_secrets
  role       = aws_iam_role.execution[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  for_each = { for k, v in local.execution_role_secrets : k => v if length(v) > 0 }
  name     = "read-task-secrets"
  role     = aws_iam_role.execution[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [for name in each.value : aws_secretsmanager_secret.staging[name].arn]
    }]
  })
}

# --- Task (runtime) roles: what the running container may call in AWS ---

resource "aws_iam_role" "api_task" {
  name               = "aims-staging-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role" "worker_task" {
  name               = "aims-staging-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role" "web_task" {
  name               = "aims-staging-web-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role" "keycloak_task" {
  name               = "aims-staging-keycloak-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role" "clamav_task" {
  name               = "aims-staging-clamav-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# API: read/write the quarantine prefix of the documents bucket only — the
# API never promotes to `active/`, only the worker does.
resource "aws_iam_role_policy" "api_s3" {
  name = "documents-bucket-access"
  role = aws_iam_role.api_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:GetObjectVersion"]
        Resource = ["${aws_s3_bucket.documents.arn}/quarantine/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [aws_kms_key.s3.arn]
      }
    ]
  })
}

# Worker: read quarantine, promote into active, read active for re-verification.
resource "aws_iam_role_policy" "worker_s3" {
  name = "documents-bucket-promote"
  role = aws_iam_role.worker_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:GetObjectVersion",
          "s3:PutObject", "s3:CopyObject",
        ]
        Resource = [
          "${aws_s3_bucket.documents.arn}/quarantine/*",
          "${aws_s3_bucket.documents.arn}/active/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [aws_kms_key.s3.arn]
      }
    ]
  })
}

# ClamAV: EFS mount authorization. MISSING in the first draft (found in
# review) — efs.tf's volume config sets
# `authorization_config.iam = "ENABLED"`, which requires the TASK role (not
# the execution role) to hold elasticfilesystem:ClientMount/ClientWrite on
# the specific file system; without this policy the task would fail to
# start with an EFS mount-authorization error.
resource "aws_iam_role_policy" "clamav_efs" {
  name = "clamav-db-efs-mount"
  role = aws_iam_role.clamav_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"]
      Resource = [aws_efs_file_system.clamav_db.arn]
      Condition = {
        StringEquals = {
          "elasticfilesystem:AccessPointArn" = aws_efs_access_point.clamav_db.arn
        }
      }
    }]
  })
}

# web/keycloak task roles intentionally receive no additional inline policy:
# web needs no AWS API access; keycloak reaches its dependencies (RDS) over
# the network, not via AWS API calls requiring IAM.
