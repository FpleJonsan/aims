# Private, versioned, encrypted document bucket. No public access under any
# circumstance. Only the api/worker task roles (iam.tf) may read/write it.

resource "aws_kms_key" "s3" {
  description             = "aims-staging document bucket encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = { Name = "aims-staging-s3-kms" }
}

resource "aws_kms_alias" "s3" {
  name          = "alias/aims-staging-documents"
  target_key_id = aws_kms_key.s3.key_id
}

resource "aws_s3_bucket" "documents" {
  bucket = "aims-staging-documents"

  tags = { Name = "aims-staging-documents" }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Explicit deny of any non-TLS request, belt-and-suspenders alongside IAM.
resource "aws_s3_bucket_policy" "documents_tls_only" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.documents.arn,
          "${aws_s3_bucket.documents.arn}/*",
        ]
        Condition = {
          Bool = { "aws:SecureTransport" = "false" }
        }
      }
    ]
  })
}
