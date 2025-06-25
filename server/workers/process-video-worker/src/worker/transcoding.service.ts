import { Injectable } from '@nestjs/common';
import { Utils, terminal } from 'video-touch-common';
import { AppConfigService } from '@/src/common/app-config/service/app-config.service';

@Injectable()
export class TranscodingService {
  constructor() {}

  async transcodeVideo(inputFilePath: string, outputFolderPath: string, height: number, width: number) {
    let command = `ffmpeg -i ${inputFilePath} -c:v libx264 -profile:v high -level 4.0 -crf 28 -c:a aac -b:a 128k -s ${width}x${height} -start_number 0 -hls_time 10 -hls_list_size 0 -f hls ${outputFolderPath}/${height}_out.m3u8`;
    //let command = `ffmpeg -i ${inputFilePath} -profile:v baseline -level 3.0 -s ${width}x${height} -start_number 0 -hls_time 10 -hls_list_size 0 -f hls ${outputFolderPath}/${height}_out.m3u8`;
    console.log('starting transcoding.... ', height);
    return terminal(command);
  }

  async transcodeVideoByResolution(videoId: string, height: number, width: number) {
    let result = null;
    try {
      let inputFilePath = Utils.getLocalVideoMp4Path(videoId, AppConfigService.appConfig.TEMP_VIDEO_DIRECTORY);
      let outputFolderPath = Utils.getLocalResolutionPath(
        videoId,
        height,
        AppConfigService.appConfig.TEMP_VIDEO_DIRECTORY,
      );
      result = await this.transcodeVideo(inputFilePath, outputFolderPath, height, width);
    } catch (e: any) {
      throw new Error(e);
    }

    return result;
  }
}
