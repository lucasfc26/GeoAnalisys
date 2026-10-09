import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Controle de acesso simples: ativo apenas quando API_TOKEN está definido no .env.
 * O cliente deve enviar o header `x-api-key`. As rotas de health continuam públicas.
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const token = process.env.API_TOKEN;
    if (!token) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path.startsWith('/api/health')) return true;
    const provided = req.header('x-api-key') ?? (req.query['apiKey'] as string | undefined);
    if (provided !== token) throw new UnauthorizedException('API key inválida ou ausente');
    return true;
  }
}
