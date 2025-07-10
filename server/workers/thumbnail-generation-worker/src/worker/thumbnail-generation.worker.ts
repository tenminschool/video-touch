import {Logger} from '@nestjs/common';
import {AppConfigService} from '@/src/common/app-config/service/app-config.service';
import {Constants, Models, terminal, Utils} from 'video-touch-common';
import {S3ClientService} from '@/src/common/aws/s3/s3-client.service';
import {RabbitMqService} from '@/src/common/rabbit-mq/service/rabbitmq.service';
import {Job} from 'bullmq';
import {Processor, WorkerHost} from '@nestjs/bullmq';

@Processor(process.env.BULL_THUMBNAIL_GENERATION_JOB_QUEUE, {
    skipLockRenewal: true,
    skipStalledCheck: true,
})
export class ThumbnailGenerationWorker extends WorkerHost {
    constructor(
        private s3ClientService: S3ClientService,
        private rabbitMqService: RabbitMqService,
    ) {
        super();
    }

    process(job: Job): Promise<any> {
        let msg: Models.ThumbnailGenerationJobModel = job.data;
        console.log('ThumbnailGenerationWorker process', msg);
        return this.handle(msg);
    }

    public async handle(msg: Models.ThumbnailGenerationJobModel) {
        console.log('ThumbnailGenerationJobHandler', msg);
        try {
            this.publishUpdateFileStatusEvent(msg.file_id, 0, Constants.FILE_STATUS.PROCESSING, 'Processing started');
            let videoPath = Utils.getLocalVideoMp4Path(
                msg.asset_id.toString(),
                AppConfigService.appConfig.TEMP_VIDEO_DIRECTORY,
            );
            let thumbnailOutputPath = Utils.getLocalThumbnailPath(
                msg.asset_id.toString(),
                AppConfigService.appConfig.TEMP_VIDEO_DIRECTORY,
            );

            await this.generateThumbnnail(videoPath, thumbnailOutputPath);
            let metadata = await this.getMetadata(thumbnailOutputPath);
            Logger.debug(metadata, 'Thumbnail metadata');

            let uploadRes = await this.s3ClientService.uploadObject(
                {
                    bucket: AppConfigService.appConfig.AWS_S3_BUCKET_NAME,
                    key: Utils.getS3ThumbnailPath(msg.asset_id.toString()),
                    filePath: thumbnailOutputPath,
                    contentType: 'image/png',
                },
                true,
            );

            Logger.debug(uploadRes, 'Thumbnail upload response');

            this.publishUpdateFileStatusEvent(msg.file_id, metadata.size, Constants.FILE_STATUS.READY, 'Thumbnail generated');
            console.log('event published');
        } catch (e: any) {
            console.log('error in thumbnail generation job handler', e);
            this.publishUpdateFileStatusEvent(msg.file_id, 0, Constants.FILE_STATUS.FAILED, e.message);
        }
    }

    async generateThumbnnail(mp4FilePath: string, thumbnailOutPutPath: string): Promise<string> {
        let thumbnailGenerationCommand = `ffmpeg -i ${mp4FilePath} -vf "thumbnail" -frames:v 1 ${thumbnailOutPutPath}`;
        let showStreamCommandRes = await terminal(thumbnailGenerationCommand);
        console.log('showStreamCommandRes', showStreamCommandRes);
        return thumbnailOutPutPath;
    }

    buildUpdateAssetStatusEventModel(
        assetId: string,
        status: string,
        details: string,
    ): Models.UpdateAssetStatusEventModel {
        return {
            asset_id: assetId,
            details: details,
            status: status,
        };
    }

    async getMetadata(url: string): Promise<{
        file_name: string;
        size: number;
        height: number;
        width: number;
        duration: number;
    }> {
        let extractMetaCommand = `ffprobe -v quiet -show_streams -show_format -print_format json ${url}`;
        let showStreamCommandRes = await terminal(extractMetaCommand);
        let parsedData = JSON.parse(showStreamCommandRes);
        let videoInfo = parsedData.streams[0];
        let format = parsedData.format;

        return {
            file_name: format.filename,
            size: +format.size,
            height: videoInfo.height,
            width: videoInfo.width,
            duration: +videoInfo.duration,
        };
    }

    // publishUpdateAssetStatusEvent(assetId: string, status: string, details: string) {
    //   try {
    //     let event = this.buildUpdateAssetStatusEventModel(assetId, status, details);
    //     this.rabbitMqService.publish(AppConfigService.appConfig.RABBIT_MQ_VIDEO_TOUCH_TOPIC_EXCHANGE, AppConfigService.appConfig.RABBIT_MQ_UPDATE_ASSET_STATUS_ROUTING_KEY, event);
    //   } catch (e) {
    //     console.log('error in publishing update asset status event', e);
    //   }
    // }
    //
    buildUpdateFileStatusEventModel(
        fileId: string,
        details: string,
        dirSize: number,
        status: string,
    ): Models.UpdateFileStatusEventModel {
        return {
            file_id: fileId,
            details: details,
            dir_size: dirSize,
            status: status,
        };
    }

    private publishUpdateFileStatusEvent(fileId: string, size: number, status: string, detail: string) {
        let event = this.buildUpdateFileStatusEventModel(fileId, detail, size, status);
        this.rabbitMqService.publish(
            AppConfigService.appConfig.RABBIT_MQ_VIDEO_TOUCH_TOPIC_EXCHANGE,
            AppConfigService.appConfig.RABBIT_MQ_UPDATE_FILE_STATUS_ROUTING_KEY,
            event,
        );
    }
}
