import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import morgan from 'morgan';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);

  app.enableCors({
    origin: 'http://localhost:4200',
    credentials: true,
  });

  app.use(helmet());
  app.use(morgan('combined'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      forbidUnknownValues: false,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`Backend running on port ${port}`);
}

bootstrap();
