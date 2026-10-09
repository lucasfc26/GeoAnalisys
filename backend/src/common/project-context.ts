import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Projeto aberto no programa (cabeçalho x-project-id, ou ?project= em downloads), visível em toda a
 * requisição — inclusive dentro das transações — sem passar o id por cada chamada.
 */
const storage = new AsyncLocalStorage<string | null>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function projectIdOf(raw: unknown): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && UUID.test(v.trim()) ? v.trim().toLowerCase() : null;
}

export function projectMiddleware(req: Request, _res: Response, next: NextFunction) {
  storage.run(projectIdOf(req.headers['x-project-id'] ?? req.query?.project), () => next());
}

/** Id do projeto da requisição atual (null = sem projeto aberto). */
export function currentProjectId(): string | null {
  return storage.getStore() ?? null;
}
