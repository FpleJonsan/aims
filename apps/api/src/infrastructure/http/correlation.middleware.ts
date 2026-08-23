import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
  }
}

export function correlationMiddleware(request: Request, response: Response, next: NextFunction): void {
  const supplied = request.header('x-correlation-id');
  request.correlationId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
  response.setHeader('x-correlation-id', request.correlationId);
  next();
}
