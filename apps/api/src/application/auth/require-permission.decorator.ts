import { SetMetadata } from "@nestjs/common";

export const PERMISSION_METADATA_KEY = "aims:required-permission";

/** Marks a handler (or every handler in a controller) as requiring a permission code from the P21 role/permission matrix. Read by PermissionGuard. */
export const RequirePermission = (permissionCode: string) => SetMetadata(PERMISSION_METADATA_KEY, permissionCode);
