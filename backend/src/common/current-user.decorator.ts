import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Identificação do usuário para auditoria (header x-user-id; padrão "local"). */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const user = req.header('x-user-id');
  return user && user.length <= 100 ? user : 'local';
});
