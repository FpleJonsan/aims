# Two independent RDS PostgreSQL instances — kept separate so Keycloak
# identity data and AIMS financial data never share a database instance,
# credential, or blast radius (plan §2/§4). Both reject public access and
# force TLS.

resource "aws_db_subnet_group" "staging" {
  name       = "aims-staging-db-subnets"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "aims-staging-db-subnets" }
}

# Forces TLS on both instances. Application connection strings must also set
# sslmode=verify-full — production-config.ts already rejects anything else.
resource "aws_db_parameter_group" "force_ssl" {
  name   = "aims-staging-force-ssl"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
}

resource "aws_db_instance" "aims" {
  identifier     = "aims-staging"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.rds_instance_class

  allocated_storage     = var.rds_allocated_storage_gb
  max_allocated_storage = var.rds_allocated_storage_gb * 3
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.aims_expected_database
  username = "aims_root_admin" # bootstrap superuser only; application roles (aims_owner/aims_migrator/aims_app/executors) are created by the existing migration/role-provisioning process, not Terraform
  # Password is generated and stored directly in Secrets Manager (see secrets.tf),
  # never placed in a .tfvars file or plan output.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.staging.name
  vpc_security_group_ids = [aws_security_group.rds_aims.id]
  parameter_group_name   = aws_db_parameter_group.force_ssl.name
  publicly_accessible    = false

  multi_az                = false # staging cost tradeoff — Production should use true
  backup_retention_period  = var.rds_backup_retention_days
  deletion_protection      = true
  skip_final_snapshot      = false
  final_snapshot_identifier = "aims-staging-final-snapshot"

  tags = { Name = "aims-staging-postgres" }
}

resource "aws_db_instance" "keycloak" {
  identifier     = "keycloak-staging"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.rds_instance_class

  allocated_storage = var.rds_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                      = "keycloak"
  username                     = "keycloak_admin"
  manage_master_user_password  = true

  db_subnet_group_name   = aws_db_subnet_group.staging.name
  vpc_security_group_ids = [aws_security_group.rds_keycloak.id]
  parameter_group_name    = aws_db_parameter_group.force_ssl.name
  publicly_accessible     = false

  multi_az                 = false
  backup_retention_period   = var.rds_backup_retention_days
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "keycloak-staging-final-snapshot"

  tags = { Name = "keycloak-staging-postgres" }
}
