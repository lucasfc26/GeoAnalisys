import { Controller, Get, HttpStatus, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  health() {
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(mem.rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('database')
  async database(@Res() res: Response) {
    const started = Date.now();
    try {
      const [row] = await this.prisma.$queryRawUnsafe<{ database: string; postgis: string | null }[]>(
        `SELECT current_database()::text AS database,
                (SELECT extversion::text FROM pg_extension WHERE extname = 'postgis') AS postgis`,
      );
      res.status(HttpStatus.OK).json({
        status: 'ok',
        database: row.database,
        postgis: row.postgis,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        status: 'unavailable',
        error: (err as Error).message.split('\n').filter(Boolean).slice(-1)[0],
        latencyMs: Date.now() - started,
      });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
