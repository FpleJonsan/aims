# Repositories for images this template does not build. CI/CD to build and
# push into these is a separate, later piece of work.

resource "aws_ecr_repository" "api" {
  name                 = "aims-staging/api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "worker" {
  name                 = "aims-staging/worker"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "aims-staging/web"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "expire_untagged" {
  for_each = {
    api    = aws_ecr_repository.api.name
    worker = aws_ecr_repository.worker.name
    web    = aws_ecr_repository.web.name
  }
  repository = each.value

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 14 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 14
        }
        action = { type = "expire" }
      }
    ]
  })
}
