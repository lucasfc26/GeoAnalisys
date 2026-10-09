import 'reflect-metadata';
import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { projectMiddleware } from './common/project-context';

// BigInt (ex.: id do AuditLog) serializado como string no JSON.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({
      json: process.env.LOG_JSON === 'true',
      colors: process.env.LOG_JSON !== 'true',
    }),
  });

  app.setGlobalPrefix('api');
  // Seleções e exportações podem enviar muitos IDs.
  app.useBodyParser('json', { limit: '25mb' });
  // Projeto aberto (x-project-id): a Tabela de Alterações é separada por projeto.
  app.use(projectMiddleware);
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('GeoAnalisys API')
    .setDescription('API REST do sistema GIS de pontos com coordenadas UTM')
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));

  const port = Number(process.env.PORT) || 3000;
  // HOST=127.0.0.1 (programa desktop): aceita conexões só da própria máquina.
  if (process.env.HOST) await app.listen(port, process.env.HOST);
  else await app.listen(port);
  Logger.log(
    `API em http://localhost:${port}/api  |  Swagger em http://localhost:${port}/api/docs`,
    'Bootstrap',
  );
}

void bootstrap();
