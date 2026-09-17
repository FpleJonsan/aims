resource "aws_ecs_cluster" "staging" {
  name = "aims-staging"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "aims-staging-cluster" }
}

resource "aws_ecs_cluster_capacity_providers" "staging" {
  cluster_name       = aws_ecs_cluster.staging.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 100
  }
}

# Service Connect namespace so services can reach each other by short name
# (e.g. the worker/api reaching "clamav:3310") without a private Route 53
# zone or hardcoded IPs.
resource "aws_service_discovery_http_namespace" "staging" {
  name        = "aims-staging.internal"
  description = "Service Connect namespace for AIMS Staging"
}
