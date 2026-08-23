import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { Principal, Role } from '../../domain/payment-request.js';
import { Postgres } from '../../infrastructure/database/postgres.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal: Principal;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly database: Postgres) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const subject = request.header('x-aims-user');
    if (!subject) throw new UnauthorizedException('Authentication required');
    if (process.env.NODE_ENV === 'production' && process.env.AUTH_TRUSTED_PROXY !== 'true') {
      throw new UnauthorizedException('Production identity proxy is not configured');
    }
    const result = await this.database.pool.query<{
      id: string; department_id: string; role: Role | null;
    }>(`
      SELECT u.id, u.department_id, ur.role
      FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.external_subject = $1 AND u.active = true
    `, [subject]);
    if (!result.rowCount) throw new UnauthorizedException('Unknown or inactive user');
    request.principal = {
      id: result.rows[0].id,
      departmentId: result.rows[0].department_id,
      roles: result.rows.flatMap((row) => row.role ? [row.role] : []),
    };
    return true;
  }
}
