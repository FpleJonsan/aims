# Small EFS volume so ClamAV keeps its virus-definition database across task
# restarts instead of a full freshclam re-download every time.

resource "aws_security_group" "efs" {
  name        = "aims-staging-efs-sg"
  description = "EFS mount targets — inbound NFS only from the clamav service"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "NFS from ClamAV"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.clamav.id]
  }

  tags = { Name = "aims-staging-efs-sg" }
}

resource "aws_efs_file_system" "clamav_db" {
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  tags = { Name = "aims-staging-clamav-db" }
}

resource "aws_efs_mount_target" "clamav_db" {
  count           = 2
  file_system_id  = aws_efs_file_system.clamav_db.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# uid/gid 100/101 are an assumption (a common convention for a "clamav"
# system account), NOT verified against the actual clamav_image's runtime
# user — found in review. If the chosen image runs clamd as a
# different uid/gid (or as root), this access point's POSIX enforcement will
# cause permission-denied errors on mount. Verify with
# `docker run --rm <clamav_image> id clamav` (or equivalent) before first
# deploy and correct these values if they differ.
resource "aws_efs_access_point" "clamav_db" {
  file_system_id = aws_efs_file_system.clamav_db.id

  posix_user {
    uid = 100
    gid = 101
  }
  root_directory {
    path = "/clamav-db"
    creation_info {
      owner_uid   = 100
      owner_gid   = 101
      permissions = "0755"
    }
  }
}
