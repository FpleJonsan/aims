# Secret SHELLS only. No value is ever set by Terraform/this repository.
# Whoever runs this must populate real values out-of-band (AWS Console/CLI,
# never committed) after the RDS instances and Keycloak realm actually exist.
#
# Naming follows apps/api/src/infrastructure/configuration/secret-boundary.ts
# where an entry already exists there (the four *_DATABASE_URL names); the
# remaining names are proposals for the Step 3 adapter code (plan §5).

locals {
  staging_secret_names = [
    "DATABASE_URL",                 # existing name in secret-boundary.ts — api runtime pool
    "FINANCE_DATABASE_URL",         # existing name — Finance executor pool
    "PAYMENT_DATABASE_URL",         # existing name — Payment executor pool
    "DOCUMENT_WORKER_DATABASE_URL", # existing name — document worker pool
    "OIDC_CLIENT_SECRET",           # proposed — Keycloak aims-app client secret
    "KEYCLOAK_DB_URL",              # proposed — keycloak-staging RDS connection
    "KEYCLOAK_ADMIN_PASSWORD",      # proposed — bootstrap only, rotate after first login
  ]
}

resource "aws_secretsmanager_secret" "staging" {
  for_each                = toset(local.staging_secret_names)
  name                    = "aims-staging/${each.value}"
  description             = "AIMS Staging — ${each.value}. Value set out-of-band, never by Terraform."
  recovery_window_in_days = 7

  tags = { Name = "aims-staging-${lower(each.value)}" }
}

# Intentionally no `aws_secretsmanager_secret_version` resource: creating one
# here would require a real credential value to pass through a .tfvars file
# or the Terraform state file, which this plan's credential-injection design
# (plan §5) explicitly avoids. Populate versions manually after the RDS
# instances/Keycloak realm exist, or wire a rotation Lambda for the RDS
# master credentials (rds.tf already uses `manage_master_user_password` for
# that piece).
