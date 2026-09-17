# One shared task execution role (pull image, write logs, read only the
# secrets a given task needs) plus a distinct, least-privilege task role per
# service (plan §5). No IAM user or static access key is created anywhere —
# AWS resource access is always via these roles.

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "ecs_task_execution" {
  name = "aims-staging-ecs-task-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Execution role also needs to read the specific secrets referenced in each
# task definition's `secrets` block (ECS resolves these at container start).
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "read-task-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [for s in aws_secretsmanager_secret.staging : s.arn]
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

# API: read/write the quarantine + active prefixes of the documents bucket.
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

# web/keycloak/clamav task roles intentionally receive no additional inline
# policy here: web needs no AWS API access; keycloak and clamav reach their
# dependencies (RDS, EFS) over the network, not via AWS API calls requiring
# IAM (EFS mount authorization is via the access point + security group,
# already scoped in efs.tf).
