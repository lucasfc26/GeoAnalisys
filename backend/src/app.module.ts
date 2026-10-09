import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { existsSync } from 'fs';
import { join } from 'path';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ApiTokenGuard } from './common/api-token.guard';
import { LoggingInterceptor } from './common/logging.interceptor';
import { AuditModule } from './modules/audit/audit.module';
import { ChangesModule } from './modules/changes/changes.module';
import { ExportModule } from './modules/export/export.module';
import { HealthModule } from './modules/health/health.controller';
import { LayersModule } from './modules/layers/layers.module';
import { MapsModule } from './modules/maps/maps.module';
import { PointsModule } from './modules/points/points.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TablesModule } from './modules/tables/tables.module';
import { PrismaModule } from './prisma/prisma.module';

/** Em produção (npm run start) o backend também serve o build do frontend. */
const FRONTEND_DIST = join(__dirname, '..', '..', 'frontend', 'dist');
const staticModules: DynamicModule[] = existsSync(join(FRONTEND_DIST, 'index.html'))
  ? [ServeStaticModule.forRoot({ rootPath: FRONTEND_DIST, exclude: ['/api/{*splat}'] })]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 1200 },
    ]),
    PrismaModule,
    AuditModule,
    ChangesModule,
    MapsModule,
    TablesModule,
    PointsModule,
    ExportModule,
    LayersModule,
    ProjectsModule,
    HealthModule,
    ...staticModules,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiTokenGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
