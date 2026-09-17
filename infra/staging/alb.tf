# One ALB, host-based routing to web/api/keycloak. Requires staging_domain
# and (optionally) route53_zone_id to be set — see plan §7 open item.

resource "aws_lb" "staging" {
  name               = "aims-staging-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = { Name = "aims-staging-alb" }
}

resource "aws_acm_certificate" "staging" {
  domain_name               = "*.${var.staging_domain}"
  subject_alternative_names = [var.staging_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# DNS validation records — only created automatically if route53_zone_id is
# supplied; otherwise create the equivalent records manually with whichever
# DNS provider hosts staging_domain.
resource "aws_route53_record" "cert_validation" {
  for_each = var.route53_zone_id == null ? {} : {
    for dvo in aws_acm_certificate.staging.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }

  zone_id = var.route53_zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60
}

resource "aws_acm_certificate_validation" "staging" {
  count                   = var.route53_zone_id == null ? 0 : 1
  certificate_arn         = aws_acm_certificate.staging.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.staging.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.staging.arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.staging.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_target_group" "web" {
  name        = "aims-staging-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging.id
  target_type = "ip"
  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "api" {
  name        = "aims-staging-api"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging.id
  target_type = "ip"
  health_check {
    path                = "/health/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "keycloak" {
  name        = "aims-staging-keycloak"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging.id
  target_type = "ip"
  health_check {
    # Keycloak 24+ serves /health/ready on the separate management listener
    # (port 9000 here, enabled via KC_HEALTH_ENABLED in ecs-services.tf), not
    # on the main traffic port — found in review; the first draft
    # health-checked port 8080, which would never return the expected path.
    port                = "9000"
    path                = "/health/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "api_host" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
  condition {
    host_header {
      values = ["api.${var.staging_domain}"]
    }
  }
}

resource "aws_lb_listener_rule" "auth_host" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.keycloak.arn
  }
  condition {
    host_header {
      values = ["auth.${var.staging_domain}"]
    }
  }
}

resource "aws_lb_listener_rule" "web_host" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
  condition {
    host_header {
      values = [var.staging_domain, "app.${var.staging_domain}"]
    }
  }
}
