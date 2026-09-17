data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnet_cidrs  = [cidrsubnet(var.vpc_cidr, 8, 0), cidrsubnet(var.vpc_cidr, 8, 1)]
  private_subnet_cidrs = [cidrsubnet(var.vpc_cidr, 8, 10), cidrsubnet(var.vpc_cidr, 8, 11)]
}

resource "aws_vpc" "staging" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "aims-staging-vpc" }
}

resource "aws_internet_gateway" "staging" {
  vpc_id = aws_vpc.staging.id
  tags   = { Name = "aims-staging-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.staging.id
  cidr_block              = local.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false # ALB gets a public IP via the load balancer itself, not the subnet default

  tags = { Name = "aims-staging-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.staging.id
  cidr_block        = local.private_subnet_cidrs[count.index]
  availability_zone = local.azs[count.index]

  tags = { Name = "aims-staging-private-${local.azs[count.index]}" }
}

resource "aws_eip" "nat" {
  count  = var.single_nat_gateway ? 1 : 2
  domain = "vpc"
  tags   = { Name = "aims-staging-nat-eip-${count.index}" }
}

resource "aws_nat_gateway" "staging" {
  count         = var.single_nat_gateway ? 1 : 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "aims-staging-nat-${count.index}" }

  depends_on = [aws_internet_gateway.staging]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.staging.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.staging.id
  }
  tags = { Name = "aims-staging-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = var.single_nat_gateway ? 1 : 2
  vpc_id = aws_vpc.staging.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = var.single_nat_gateway ? aws_nat_gateway.staging[0].id : aws_nat_gateway.staging[count.index].id
  }
  tags = { Name = "aims-staging-private-rt-${count.index}" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = var.single_nat_gateway ? aws_route_table.private[0].id : aws_route_table.private[count.index].id
}

# Free Gateway endpoint: keeps API/worker <-> S3 traffic off the NAT Gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.staging.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.single_nat_gateway ? [aws_route_table.private[0].id] : aws_route_table.private[*].id

  tags = { Name = "aims-staging-s3-endpoint" }
}
