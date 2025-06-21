import { Module } from '@nestjs/common';
import { AppConfigModule } from '@/src/common/app-config/app-config.module';
import { HttpClientsModule } from '@/src/common/http-clients/http-clients.module';
import { DownloadVideoJobHandler } from '@/src/worker/download-video.worker';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigService } from '@/src/common/app-config/service/app-config.service';
import { RabbitMQModule } from '@/src/common/rabbit-mq/rabbit-mq.module';

@Module({
  imports: [
    AppConfigModule,
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: () => ({
        connection: {
          host: AppConfigService.appConfig.REDIS_HOST,
          port: AppConfigService.appConfig.REDIS_PORT,
        },
      }),
    }),
    BullModule.registerQueueAsync({
      inject: [AppConfigService],
      useFactory: () => ({
        name: AppConfigService.appConfig.BULL_DOWNLOAD_JOB_QUEUE,
      }),
    }),
    HttpClientsModule,
    RabbitMQModule,
  ],
  controllers: [],
  providers: [DownloadVideoJobHandler],
})
export class WorkerModule {}
