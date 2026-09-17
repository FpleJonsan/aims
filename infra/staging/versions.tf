terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # DRAFT: no backend configured yet. Do not run `terraform apply` with
  # local state against a real account. Configure a remote backend (e.g.
  # S3 + DynamoDB lock table, itself reviewed separately) before real use.
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AIMS"
      Environment = "staging"
      ManagedBy   = "terraform"
      Isolation   = "staging-only-no-production-access"
    }
  }
}
