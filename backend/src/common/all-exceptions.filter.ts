import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

const PG_CODE_MAP: Record<string, { status: number; error: string; message: string }> = {
  '22P02': { status: 400, error: 'INVALID_VALUE', message: 'Valor inválido para o tipo da coluna' },
  '22007': { status: 400, error: 'INVALID_VALUE', message: 'Data/hora em formato inválido' },
  '22008': { status: 400, error: 'INVALID_VALUE', message: 'Data/hora fora do intervalo' },
  '22003': { status: 400, error: 'INVALID_VALUE', message: 'Número fora do intervalo da coluna' },
  '22001': { status: 400, error: 'INVALID_VALUE', message: 'Texto maior que o tamanho da coluna' },
  '23502': { status: 400, error: 'NOT_NULL', message: 'Campo obrigatório não informado' },
  '23514': { status: 400, error: 'CHECK_VIOLATION', message: 'Valor viola uma restrição da tabela' },
  '23505': { status: 409, error: 'DUPLICATE', message: 'Registro duplicado (chave única)' },
  '23503': { status: 409, error: 'FOREIGN_KEY', message: 'Registro relacionado a outra tabela' },
  '42P01': { status: 400, error: 'TABLE_NOT_FOUND', message: 'Tabela não encontrada no banco' },
  '42703': { status: 400, error: 'COLUMN_NOT_FOUND', message: 'Coluna não encontrada no banco' },
  '42804': { status: 400, error: 'INVALID_VALUE', message: 'Tipo de valor incompatível' },
  '42501': { status: 403, error: 'DB_PERMISSION', message: 'Sem permissão no banco de dados' },
  '57014': { status: 504, error: 'TIMEOUT', message: 'Consulta cancelada por tempo excedido' },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const body = this.toBody(exception, req.originalUrl ?? req.url);

    if (body.statusCode >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} -> ${body.statusCode} ${body.error}: ${String(body.message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${req.method} ${req.originalUrl} -> ${body.statusCode} ${body.error}`);
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown, path: string): ErrorBody {
    const base = { path, timestamp: new Date().toISOString() };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const r = exception.getResponse();
      const message =
        typeof r === 'string' ? r : ((r as { message?: string | string[] }).message ?? exception.message);
      return { ...base, statusCode: status, error: HttpStatus[status] ?? 'ERROR', message };
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        ...base,
        statusCode: 503,
        error: 'DATABASE_UNAVAILABLE',
        message: 'Banco de dados indisponível. Verifique a conexão (DATABASE_URL).',
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (['P1001', 'P1002', 'P1017', 'P1000', 'P1003'].includes(exception.code)) {
        return {
          ...base,
          statusCode: 503,
          error: 'DATABASE_UNAVAILABLE',
          message: 'Banco de dados indisponível.',
        };
      }
      if (exception.code === 'P2025') {
        return { ...base, statusCode: 404, error: 'NOT_FOUND', message: 'Registro não encontrado' };
      }
      if (exception.code === 'P2010') {
        const meta = (exception.meta ?? {}) as { code?: string; message?: string };
        const pgCode = meta.code ?? /Code: `(\w+)`/.exec(exception.message)?.[1];
        const mapped = pgCode ? PG_CODE_MAP[pgCode] : undefined;
        const detail = meta.message ?? exception.message;
        if (mapped) {
          return {
            ...base,
            statusCode: mapped.status,
            error: mapped.error,
            message: `${mapped.message}: ${detail}`,
          };
        }
        return { ...base, statusCode: 500, error: 'DATABASE_ERROR', message: detail };
      }
    }

    const message = exception instanceof Error ? exception.message : 'Erro interno';
    if (/ECONNREFUSED|Can't reach database server/i.test(message)) {
      return { ...base, statusCode: 503, error: 'DATABASE_UNAVAILABLE', message: 'Banco de dados indisponível.' };
    }
    return { ...base, statusCode: 500, error: 'INTERNAL_ERROR', message };
  }
}
