# AIMS Staging — Infrastructure Templates (DRAFT, NOT APPLIED)

These Terraform files are **templates for review**, matching
`docs/production/staging-s0-environment-plan.md`. Nothing here has been
applied. Do not run `terraform apply` against a real AWS account until:

1. The plan document has been reviewed and approved.
2. `terraform.tfvars` (copied from `terraform.tfvars.example`, never
   committed) has real values for `aws_region`, `staging_domain`,
   `route53_zone_id` (if applicable), and the RDS/Keycloak admin bootstrap
   password sources.
3. Someone with an approved AWS account and IAM permissions is the one
   running `terraform plan`/`apply` — this repository and this assistant do
   not hold AWS credentials.
4. Budget in `docs/production/staging-s0-environment-plan.md` §6 is
   approved.

## What is intentionally left out of these templates

- **No adapter code.** These templates provision infrastructure only. The
  `KeycloakIdentityProvider`, the S3 `DocumentStorage` adapter, and the
  ClamAV `DocumentMalwareScanner` adapter (see the plan document §1) are a
  separate, later application-code change, reviewed on their own.
- **No container images.** `ecs.tf` references image URIs by Terraform
  variable (`api_image`, `worker_image`, `web_image`) that must point at an
  ECR repository this template creates (`ecr.tf`) — but nothing here builds
  or pushes an image. CI/CD for that is out of scope for S0.
- **No real secret values.** `secrets.tf` creates empty Secrets Manager
  secret *shells*; populating them (database passwords, OIDC client secret,
  Keycloak admin bootstrap password) is a manual, out-of-band step by
  whoever runs this, never committed to the repository.
- **No DNS zone creation assumption.** `alb.tf`/`acm.tf` assume a Route 53
  hosted zone ID is supplied as a variable; if the domain is managed
  elsewhere, ACM DNS validation records must be created there manually.

## File map

| File | Contents |
| --- | --- |
| `versions.tf` | Terraform/provider version pins |
| `variables.tf` | All inputs, most with no default (forces explicit review) |
| `network.tf` | VPC, public/private subnets (2 AZs), IGW, 1 NAT Gateway, route tables, S3 gateway endpoint |
| `security-groups.tf` | Least-privilege, reference-based security groups |
| `rds.tf` | Two RDS PostgreSQL instances: `aims-staging`, `keycloak-staging` |
| `s3.tf` | `aims-staging-documents` bucket: versioning, SSE-KMS, block public access |
| `ecr.tf` | Container repositories for api/worker/web images |
| `ecs-cluster.tf` | Fargate ECS cluster |
| `ecs-services.tf` | 5 task definitions + services: web, api, worker, keycloak, clamav |
| `efs.tf` | Small EFS volume for ClamAV virus-definition persistence |
| `alb.tf` | ALB, target groups, host-based listener rules, ACM certificate |
| `iam.tf` | Task execution role + 5 distinct least-privilege task roles |
| `secrets.tf` | Secrets Manager secret shells (no values) |
| `logs.tf` | CloudWatch log groups, 14-day retention |
| `outputs.tf` | ALB DNS name, RDS endpoints, ECR repo URLs, etc. |
| `terraform.tfvars.example` | Copy to `terraform.tfvars`, fill in, never commit |

## Estimated cost

See `docs/production/staging-s0-environment-plan.md` §6 — roughly
$255/month at 24/7 in the assumed (unconfirmed) `ap-southeast-1` region, with
documented levers to reduce it (primarily: stop tasks/RDS outside test
windows).
