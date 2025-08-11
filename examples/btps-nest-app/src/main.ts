import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // Create application context (no HTTP server, just for dependency injection)

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('🛑 Shutting down...');
    await app.close();
  });

  process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down...');
    await app.close();
  });
}

bootstrap().catch(error => {
  console.error('Failed to start BTPS server:', error);
  process.exit(1);
});
