import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  sourceId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

type Tx = Prisma.TransactionClient | PrismaService;

const json = (v: unknown) =>
  v === undefined || v === null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx: Tx = this.prisma) {
    await tx.auditLog.create({ data: this.toData(entry) });
  }

  async logMany(entries: AuditEntry[], tx: Tx = this.prisma) {
    for (let i = 0; i < entries.length; i += 1000) {
      await tx.auditLog.createMany({ data: entries.slice(i, i + 1000).map((e) => this.toData(e)) });
    }
  }

  async list(params: { sourceId?: string; entityId?: string; take?: number; skip?: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(params.sourceId ? { sourceId: params.sourceId } : {}),
      ...(params.entityId ? { entityId: params.entityId } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(params.take ?? 50, 500),
        skip: params.skip ?? 0,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { total, items: items.map((i) => ({ ...i, id: i.id.toString() })) };
  }

  /** Diferença campo a campo entre dois registros. */
  static diff(oldRow: Record<string, unknown>, newRow: Record<string, unknown>) {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    for (const key of Object.keys(newRow)) {
      if (JSON.stringify(oldRow[key] ?? null) !== JSON.stringify(newRow[key] ?? null)) {
        oldValue[key] = oldRow[key] ?? null;
        newValue[key] = newRow[key] ?? null;
      }
    }
    return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
  }

  private toData(e: AuditEntry): Prisma.AuditLogCreateManyInput {
    return {
      userId: e.userId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      sourceId: e.sourceId ?? null,
      oldValue: json(e.oldValue),
      newValue: json(e.newValue),
    };
  }
}
