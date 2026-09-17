resource "aws_cloudwatch_log_group" "services" {
  for_each          = toset(["web", "api", "worker", "keycloak", "clamav"])
  name              = "/aims-staging/${each.value}"
  retention_in_days = 14

  tags = { Name = "aims-staging-${each.value}-logs" }
}
