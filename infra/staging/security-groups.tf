# Least-privilege, reference-based security groups.
#
# IMPORTANT FIX (found in review): alb/web/api/keycloak/clamav
# reference each other bidirectionally (e.g. alb -> web and web -> alb). The
# first draft used inline `ingress`/`egress` blocks directly on
# `aws_security_group`, which creates a genuine dependency cycle in
# Terraform's graph (`Error: Cycle`) the moment two groups reference each
# other's `.id`. Fixed by declaring bare security-group "shells" here and
# every rule as its own `aws_vpc_security_group_ingress_rule` /
# `..._egress_rule` resource — Terraform can then create all shells first
# (no inter-dependency among the shells themselves) and attach
# cross-referencing rules afterward. No rule anywhere allows 0.0.0.0/0
# ingress except the ALB's public HTTPS listener.

resource "aws_security_group" "alb" {
  name        = "aims-staging-alb-sg"
  description = "Public ALB: HTTPS in, private app/keycloak targets out"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-alb-sg" }
}

resource "aws_security_group" "web" {
  name        = "aims-staging-web-sg"
  description = "Web (frontend) service"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-web-sg" }
}

resource "aws_security_group" "api" {
  name        = "aims-staging-api-sg"
  description = "API service"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-api-sg" }
}

resource "aws_security_group" "worker" {
  name        = "aims-staging-worker-sg"
  description = "Document scan worker — no inbound ingress at all"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-worker-sg" }
}

resource "aws_security_group" "keycloak" {
  name        = "aims-staging-keycloak-sg"
  description = "Keycloak — reachable from ALB (login UI) and API (token exchange)"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-keycloak-sg" }
}

resource "aws_security_group" "clamav" {
  name        = "aims-staging-clamav-sg"
  description = "ClamAV — reachable only from api/worker on the clamd port"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-clamav-sg" }
}

resource "aws_security_group" "rds_aims" {
  name        = "aims-staging-rds-aims-sg"
  description = "aims-staging RDS — inbound only from api/worker"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-rds-aims-sg" }
}

resource "aws_security_group" "rds_keycloak" {
  name        = "aims-staging-rds-keycloak-sg"
  description = "keycloak-staging RDS — inbound only from keycloak"
  vpc_id      = aws_vpc.staging.id
  tags        = { Name = "aims-staging-rds-keycloak-sg" }
}

# --- ALB ---

resource "aws_vpc_security_group_ingress_rule" "alb_from_internet_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from internet"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_web" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To web target group"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.web.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To API target group"
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_keycloak" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To Keycloak login UI"
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  referenced_security_group_id = aws_security_group.keycloak.id
}

resource "aws_vpc_security_group_egress_rule" "alb_to_keycloak_health" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To Keycloak management/health port"
  ip_protocol                  = "tcp"
  from_port                    = 9000
  to_port                      = 9000
  referenced_security_group_id = aws_security_group.keycloak.id
}

# --- web ---

resource "aws_vpc_security_group_ingress_rule" "web_from_alb" {
  security_group_id            = aws_security_group.web.id
  description                  = "From ALB only"
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "web_to_api" {
  security_group_id            = aws_security_group.web.id
  description                  = "To API (same-origin server-side calls, if used)"
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  referenced_security_group_id = aws_security_group.api.id
}

# --- api ---

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "From ALB"
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_web" {
  security_group_id            = aws_security_group.api.id
  description                  = "From web"
  ip_protocol                  = "tcp"
  from_port                    = 3001
  to_port                      = 3001
  referenced_security_group_id = aws_security_group.web.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_rds" {
  security_group_id            = aws_security_group.api.id
  description                  = "To aims-staging RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds_aims.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_keycloak" {
  security_group_id            = aws_security_group.api.id
  description                  = "To Keycloak (token exchange)"
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  referenced_security_group_id = aws_security_group.keycloak.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_clamav" {
  security_group_id            = aws_security_group.api.id
  description                  = "To ClamAV clamd"
  ip_protocol                  = "tcp"
  from_port                    = 3310
  to_port                      = 3310
  referenced_security_group_id = aws_security_group.clamav.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_aws_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS to Secrets Manager / S3 gateway endpoint / ECR / CloudWatch / OIDC issuer"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# --- worker (no ingress at all) ---

resource "aws_vpc_security_group_egress_rule" "worker_to_rds" {
  security_group_id            = aws_security_group.worker.id
  description                  = "To aims-staging RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds_aims.id
}

resource "aws_vpc_security_group_egress_rule" "worker_to_clamav" {
  security_group_id            = aws_security_group.worker.id
  description                  = "To ClamAV clamd"
  ip_protocol                  = "tcp"
  from_port                    = 3310
  to_port                      = 3310
  referenced_security_group_id = aws_security_group.clamav.id
}

resource "aws_vpc_security_group_egress_rule" "worker_to_aws_https" {
  security_group_id = aws_security_group.worker.id
  description       = "HTTPS to Secrets Manager / S3 gateway endpoint / ECR / CloudWatch"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# --- keycloak ---

resource "aws_vpc_security_group_ingress_rule" "keycloak_from_alb" {
  security_group_id            = aws_security_group.keycloak.id
  description                  = "From ALB (login UI)"
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "keycloak_health_from_alb" {
  security_group_id            = aws_security_group.keycloak.id
  description                  = "From ALB (health check on the management port)"
  ip_protocol                  = "tcp"
  from_port                    = 9000
  to_port                      = 9000
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_ingress_rule" "keycloak_from_api" {
  security_group_id            = aws_security_group.keycloak.id
  description                  = "From API (token exchange)"
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_egress_rule" "keycloak_to_rds" {
  security_group_id            = aws_security_group.keycloak.id
  description                  = "To keycloak-staging RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds_keycloak.id
}

# --- clamav ---

resource "aws_vpc_security_group_ingress_rule" "clamav_from_api" {
  security_group_id            = aws_security_group.clamav.id
  description                  = "clamd INSTREAM from API"
  ip_protocol                  = "tcp"
  from_port                    = 3310
  to_port                      = 3310
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "clamav_from_worker" {
  security_group_id            = aws_security_group.clamav.id
  description                  = "clamd INSTREAM from worker"
  ip_protocol                  = "tcp"
  from_port                    = 3310
  to_port                      = 3310
  referenced_security_group_id = aws_security_group.worker.id
}

resource "aws_vpc_security_group_egress_rule" "clamav_freshclam_https" {
  security_group_id = aws_security_group.clamav.id
  description       = "freshclam virus-definition mirrors (via NAT)"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# DNS resolution for the freshclam mirror hostnames — missing in the first
# draft, which only opened 443 and would have left freshclam unable to
# resolve database.clamav.net.
resource "aws_vpc_security_group_egress_rule" "clamav_dns_tcp" {
  security_group_id = aws_security_group.clamav.id
  description       = "DNS (TCP) to the VPC resolver"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "clamav_dns_udp" {
  security_group_id = aws_security_group.clamav.id
  description       = "DNS (UDP) to the VPC resolver"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = var.vpc_cidr
}

# --- RDS ---
#
# No egress rule is defined for rds_aims/rds_keycloak/efs on purpose (not an
# oversight): neither instance uses a feature that needs the DB's own
# outbound path (no CloudWatch Logs export configured; RDS-managed master
# password rotation is AWS-internal control plane, not instance egress).
# This matches docs/production/p13-production-topology.md's network-zone
# table, where the Database zone's only permitted outbound is a
# backup/monitoring service that does not traverse the instance's ENI/SG.
# If CloudWatch Logs export or a customer-run rotation Lambda is added
# later, add the specific egress this needs then — do not default to
# allow-all.

resource "aws_vpc_security_group_ingress_rule" "rds_aims_from_api" {
  security_group_id            = aws_security_group.rds_aims.id
  description                  = "PostgreSQL from API"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_aims_from_worker" {
  security_group_id            = aws_security_group.rds_aims.id
  description                  = "PostgreSQL from worker"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.worker.id
}

resource "aws_vpc_security_group_ingress_rule" "rds_keycloak_from_keycloak" {
  security_group_id            = aws_security_group.rds_keycloak.id
  description                  = "PostgreSQL from Keycloak"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.keycloak.id
}
