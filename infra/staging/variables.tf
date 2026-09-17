# Variables with no default are open items (see plan §7) and must be set in
# terraform.tfvars before this is ever applied. Variables with a default are
# S0 planning defaults, not approved production values.

variable "aws_region" {
  description = "AWS region for the Staging environment. OPEN ITEM (plan §7, P13-C01) — no default on purpose."
  type        = string
}

variable "staging_domain" {
  description = "Base domain for Staging, e.g. staging.aims.example.com. OPEN ITEM (plan §7) — no default on purpose."
  type        = string
}

variable "route53_zone_id" {
  description = "Existing Route 53 hosted zone ID for staging_domain, if DNS is delegated to AWS. Leave null to manage DNS/ACM validation manually elsewhere."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "CIDR block for the dedicated Staging VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "availability_zones" {
  description = "Two AZs for subnet redundancy."
  type        = list(string)
  default     = []
  # Left empty on purpose: populate from `data.aws_availability_zones` in
  # network.tf at plan time for the chosen region rather than hardcoding here.
}

variable "single_nat_gateway" {
  description = "Use exactly one NAT Gateway (staging cost tradeoff; Production should use one per AZ)."
  type        = bool
  default     = true
}

# --- Compute sizing (planning defaults, see plan §6 cost estimate) ---

variable "fargate_sizing" {
  description = "cpu/memory (Fargate units: 256=0.25vCPU, 512=0.5vCPU, 1024=1vCPU; memory in MiB) per service."
  type = map(object({
    cpu    = number
    memory = number
  }))
  default = {
    web      = { cpu = 256, memory = 512 }
    api      = { cpu = 512, memory = 1024 }
    worker   = { cpu = 512, memory = 1024 }
    keycloak = { cpu = 1024, memory = 2048 }
    clamav   = { cpu = 1024, memory = 2048 }
  }
}

variable "desired_count" {
  description = "Task count per service. Kept at 1 for S0 (no HA claim yet)."
  type        = number
  default     = 1
}

# --- Images (built/pushed by a separate CI process, not this template) ---

variable "web_image" {
  description = "Full image URI (with digest) for the web service. Placeholder until CI/CD exists."
  type        = string
  default     = "PLACEHOLDER_UNSET"
}

variable "api_image" {
  description = "Full image URI (with digest) for the API service."
  type        = string
  default     = "PLACEHOLDER_UNSET"
}

variable "worker_image" {
  description = "Full image URI (with digest) for the worker service."
  type        = string
  default     = "PLACEHOLDER_UNSET"
}

variable "keycloak_image" {
  description = "Keycloak image (upstream quay.io/keycloak/keycloak or a company-mirrored copy in ECR)."
  type        = string
  default     = "quay.io/keycloak/keycloak:26.0"
}

variable "clamav_image" {
  description = "ClamAV image (upstream clamav/clamav or a company-mirrored copy in ECR)."
  type        = string
  default     = "clamav/clamav:1.4"
}

# --- Database ---

variable "rds_instance_class" {
  description = "Instance class for both RDS instances (planning default, not a capacity decision)."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "rds_backup_retention_days" {
  type    = number
  default = 7
}

variable "aims_expected_database" {
  description = "Value for AIMS_EXPECTED_DATABASE — must not be aims/aims_competition/postgres/template0/template1 (rejected by production-config.ts)."
  type        = string
  default     = "aims_staging"
}
