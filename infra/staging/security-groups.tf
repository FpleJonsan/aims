# Least-privilege, reference-based security groups. No rule here allows
# 0.0.0.0/0 ingress except the ALB's public HTTPS listener.

resource "aws_security_group" "alb" {
  name        = "aims-staging-alb-sg"
  description = "Public ALB: HTTPS in, private app/keycloak targets out"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To web/api/keycloak targets"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id, aws_security_group.api.id, aws_security_group.keycloak.id]
  }

  tags = { Name = "aims-staging-alb-sg" }
}

resource "aws_security_group" "web" {
  name        = "aims-staging-web-sg"
  description = "Web (frontend) service"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "From ALB only"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "To API"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "aims-staging-web-sg" }
}

resource "aws_security_group" "api" {
  name        = "aims-staging-api-sg"
  description = "API service"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "From ALB"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description     = "From web (same-origin server-side calls, if used)"
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.web.id]
  }

  egress {
    description = "To RDS, Keycloak, ClamAV, S3 endpoint, Secrets Manager, ECR, CloudWatch"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    description = "HTTPS to AWS service endpoints / OIDC over private network"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "aims-staging-api-sg" }
}

resource "aws_security_group" "worker" {
  name        = "aims-staging-worker-sg"
  description = "Document scan worker — no inbound ingress at all"
  vpc_id      = aws_vpc.staging.id

  egress {
    description = "To RDS, ClamAV, S3 endpoint, Secrets Manager"
    from_port   = 0
    to_port     = 65535
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }
  egress {
    description = "HTTPS to AWS service endpoints"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "aims-staging-worker-sg" }
}

resource "aws_security_group" "keycloak" {
  name        = "aims-staging-keycloak-sg"
  description = "Keycloak — reachable from ALB (login UI) and API (token exchange)"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "From ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    description     = "From API"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    description = "To its own RDS instance"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "aims-staging-keycloak-sg" }
}

resource "aws_security_group" "clamav" {
  name        = "aims-staging-clamav-sg"
  description = "ClamAV — reachable only from api/worker on the clamd port; outbound only for virus-definition updates"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "clamd INSTREAM from API"
    from_port       = 3310
    to_port         = 3310
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  ingress {
    description     = "clamd INSTREAM from worker"
    from_port       = 3310
    to_port         = 3310
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  egress {
    description = "freshclam virus-definition mirrors (needs internet via NAT)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "aims-staging-clamav-sg" }
}

resource "aws_security_group" "rds_aims" {
  name        = "aims-staging-rds-aims-sg"
  description = "aims-staging RDS — inbound only from api/worker"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "PostgreSQL from API"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  ingress {
    description     = "PostgreSQL from worker"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.worker.id]
  }

  tags = { Name = "aims-staging-rds-aims-sg" }
}

resource "aws_security_group" "rds_keycloak" {
  name        = "aims-staging-rds-keycloak-sg"
  description = "keycloak-staging RDS — inbound only from keycloak"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "PostgreSQL from Keycloak"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.keycloak.id]
  }

  tags = { Name = "aims-staging-rds-keycloak-sg" }
}
