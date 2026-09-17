output "alb_dns_name" {
  value       = aws_lb.staging.dns_name
  description = "Point staging_domain / api.staging_domain / auth.staging_domain CNAMEs (or an ALIAS record if using Route 53) here."
}

output "ecr_repository_urls" {
  value = {
    api    = aws_ecr_repository.api.repository_url
    worker = aws_ecr_repository.worker.repository_url
    web    = aws_ecr_repository.web.repository_url
  }
}

output "rds_aims_endpoint" {
  value = aws_db_instance.aims.endpoint
}

output "rds_keycloak_endpoint" {
  value = aws_db_instance.keycloak.endpoint
}

output "rds_master_secret_arns" {
  description = "Secrets Manager ARNs where RDS auto-created the master-user password (manage_master_user_password)."
  value = {
    aims     = aws_db_instance.aims.master_user_secret[0].secret_arn
    keycloak = aws_db_instance.keycloak.master_user_secret[0].secret_arn
  }
}

output "documents_bucket" {
  value = aws_s3_bucket.documents.bucket
}

output "staging_secret_arns" {
  description = "Empty secret shells to be populated out-of-band before first deploy."
  value       = { for k, s in aws_secretsmanager_secret.staging : k => s.arn }
}
