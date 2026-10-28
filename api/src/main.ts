import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { EnvironmentVariables } from './config/environment.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  // 0.0.0.0, not localhost: inside a container the port must be reachable from outside.
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}
await bootstrap();
