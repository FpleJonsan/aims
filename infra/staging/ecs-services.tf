# Five Fargate services. Each references its own least-privilege task role
# (iam.tf), its own log group (logs.tf), and only the Secrets Manager entries
# it actually needs (secrets.tf). Service Connect gives private DNS names
# (e.g. "clamav", "keycloak") so nothing depends on hardcoded IPs.
#
# STORAGE_DRIVER=object and MALWARE_SCANNER_DRIVER=provider are already
# accepted values in provider-boundary.ts today; setting them here does NOT
# make Staging work by itself — the S3 and ClamAV adapter classes still need
# to be written (plan §1, Step 3, separate change). Until then the API will
# still fail to start with APPROVED_OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED /
# APPROVED_MALWARE_SCANNER_PROVIDER_NOT_IMPLEMENTED, which is the correct
# fail-closed behavior.

locals {
  common_env = {
    AIMS_ENVIRONMENT        = "staging"
    NODE_ENV                = "production"
    AIMS_EXPECTED_DATABASE  = var.aims_expected_database
    AIMS_SESSION_COOKIE_SECURE = "true"
    STORAGE_DRIVER          = "object"
    MALWARE_SCANNER_DRIVER  = "provider"
    S3_BUCKET               = aws_s3_bucket.documents.bucket
    S3_REGION               = var.aws_region
    CLAMAV_HOST             = "clamav.aims-staging.internal"
    CLAMAV_PORT             = "3310"
    OIDC_ISSUER_URL         = "https://auth.${var.staging_domain}/realms/aims-staging"
    OIDC_CLIENT_ID          = "aims-app"
  }
}

# --- api ---

resource "aws_ecs_task_definition" "api" {
  family                   = "aims-staging-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_sizing.api.cpu
  memory                   = var.fargate_sizing.api.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([{
    name      = "api"
    image     = var.api_image
    essential = true
    portMappings = [{ name = "api-3001", containerPort = 3001, protocol = "tcp" }]
    environment = [for k, v in local.common_env : { name = k, value = v }]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.staging["DATABASE_URL"].arn },
      { name = "FINANCE_DATABASE_URL", valueFrom = aws_secretsmanager_secret.staging["FINANCE_DATABASE_URL"].arn },
      { name = "PAYMENT_DATABASE_URL", valueFrom = aws_secretsmanager_secret.staging["PAYMENT_DATABASE_URL"].arn },
      { name = "OIDC_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.staging["OIDC_CLIENT_SECRET"].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["api"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.api.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name    = "api"
    container_port    = 3001
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.staging.arn
  }
}

# --- worker ---

resource "aws_ecs_task_definition" "worker" {
  family                   = "aims-staging-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_sizing.worker.cpu
  memory                   = var.fargate_sizing.worker.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.worker_task.arn

  container_definitions = jsonencode([{
    name      = "worker"
    image     = var.worker_image
    essential = true
    environment = concat(
      [for k, v in local.common_env : { name = k, value = v }],
      [
        { name = "DOCUMENT_SCAN_WORKER_ENABLED", value = "true" },
        { name = "WORKER_POLL_INTERVAL_MS", value = "1000" },
        { name = "WORKER_BATCH_SIZE", value = "10" },
        { name = "DOCUMENT_SCAN_LEASE_SECONDS", value = "120" },
        { name = "DOCUMENT_SCAN_MAX_ATTEMPTS", value = "5" },
        { name = "DOCUMENT_SCAN_RETRY_DELAY_SECONDS", value = "300" },
        { name = "DOCUMENT_SCAN_STORAGE_TIMEOUT_MS", value = "10000" },
        { name = "DOCUMENT_SCAN_SCANNER_TIMEOUT_MS", value = "30000" },
        { name = "DOCUMENT_SCAN_LEASE_SAFETY_MARGIN_MS", value = "5000" },
        { name = "WORKER_SHUTDOWN_GRACE_MS", value = "15000" },
      ]
    )
    secrets = [
      { name = "DOCUMENT_WORKER_DATABASE_URL", valueFrom = aws_secretsmanager_secret.staging["DOCUMENT_WORKER_DATABASE_URL"].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["worker"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "worker"
      }
    }
  }])
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.worker.id]
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.staging.arn
  }
}

# --- web ---

resource "aws_ecs_task_definition" "web" {
  family                   = "aims-staging-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_sizing.web.cpu
  memory                   = var.fargate_sizing.web.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  container_definitions = jsonencode([{
    name      = "web"
    image     = var.web_image
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "NEXT_PUBLIC_AIMS_API_URL", value = "https://api.${var.staging_domain}" },
      { name = "NEXT_PUBLIC_AIMS_LOGOUT_URL", value = "https://auth.${var.staging_domain}/realms/aims-staging/protocol/openid-connect/logout" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["web"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "web"
      }
    }
  }])
}

resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.web.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name    = "web"
    container_port    = 3000
  }
}

# --- keycloak ---

resource "aws_ecs_task_definition" "keycloak" {
  family                   = "aims-staging-keycloak"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_sizing.keycloak.cpu
  memory                   = var.fargate_sizing.keycloak.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.keycloak_task.arn

  container_definitions = jsonencode([{
    name      = "keycloak"
    image     = var.keycloak_image
    essential = true
    command   = ["start", "--optimized"]
    portMappings = [{ name = "keycloak-8080", containerPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "KC_DB", value = "postgres" },
      { name = "KC_HOSTNAME", value = "auth.${var.staging_domain}" },
      { name = "KC_PROXY_HEADERS", value = "xforwarded" },
      { name = "KC_HTTP_ENABLED", value = "true" }, # TLS terminates at the ALB; internal hop is private-network HTTP
      { name = "KC_BOOTSTRAP_ADMIN_USERNAME", value = "aims-staging-admin" },
    ]
    secrets = [
      { name = "KC_DB_URL", valueFrom = aws_secretsmanager_secret.staging["KEYCLOAK_DB_URL"].arn },
      { name = "KC_BOOTSTRAP_ADMIN_PASSWORD", valueFrom = aws_secretsmanager_secret.staging["KEYCLOAK_ADMIN_PASSWORD"].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["keycloak"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "keycloak"
      }
    }
  }])
}

resource "aws_ecs_service" "keycloak" {
  name            = "keycloak"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.keycloak.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.keycloak.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.keycloak.arn
    container_name    = "keycloak"
    container_port    = 8080
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.staging.arn
    service {
      port_name      = "keycloak-8080"
      discovery_name = "keycloak"
    }
  }
}

# --- clamav ---

resource "aws_ecs_task_definition" "clamav" {
  family                   = "aims-staging-clamav"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.fargate_sizing.clamav.cpu
  memory                   = var.fargate_sizing.clamav.memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.clamav_task.arn

  volume {
    name = "clamav-db"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.clamav_db.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.clamav_db.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([{
    name      = "clamav"
    image     = var.clamav_image
    essential = true
    portMappings = [{ name = "clamav-3310", containerPort = 3310, protocol = "tcp" }]
    environment = [
      { name = "CLAMAV_NO_FRESHCLAMD", value = "false" },
      { name = "CLAMAV_NO_CLAMD", value = "false" },
    ]
    mountPoints = [{
      sourceVolume  = "clamav-db"
      containerPath = "/var/lib/clamav"
      readOnly      = false
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "clamdcheck.sh || exit 1"]
      interval    = 30
      timeout     = 10
      retries     = 3
      startPeriod = 120 # first virus-DB sync can take a while
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.services["clamav"].name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "clamav"
      }
    }
  }])
}

resource "aws_ecs_service" "clamav" {
  name            = "clamav"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.clamav.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.clamav.id]
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.staging.arn
    service {
      port_name      = "clamav-3310"
      discovery_name = "clamav"
    }
  }
}
