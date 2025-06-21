import { Injectable } from '@nestjs/common';
import { CreateAssetFromUploadInputDto, CreateAssetInputDto } from '../dtos/create-asset-input.dto';
import { AssetDocument } from '../schemas/assets.schema';
import { AssetRepository } from '@/src/api/assets/repositories/asset.repository';
import { ListAssetInputDto } from '@/src/api/assets/dtos/list-asset-input.dto';
import { GetAssetInputDto } from '@/src/api/assets/dtos/get-asset-input.dto';
import { UpdateAssetInputDto } from '@/src/api/assets/dtos/update-asset-input.dto';
import { AppConfigService } from '@/src/common/app-config/service/app-config.service';
import mongoose from 'mongoose';
import fs from 'fs';
import { FileRepository } from '@/src/api/assets/repositories/file.repository';
import { AssetMapper } from '@/src/api/assets/mapper/asset.mapper';
import { JobManagerService } from '@/src/api/assets/services/job-manager.service';
import { FileMapper } from '@/src/api/assets/mapper/file.mapper';
import { Constants, Models, Utils } from 'video-touch-common';
import { HeightWidthMap } from '@/src/api/assets/models/file.model';
import { FileDocument } from '@/src/api/assets/schemas/files.schema';
import { UserDocument } from '@/src/api/auth/schemas/user.schema';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Injectable()
export class AssetService {
  constructor(
    private repository: AssetRepository,
    private fileRepository: FileRepository,
    private jobManagerService: JobManagerService,
    @InjectQueue('process_video_360p') private videoProcessQueue360p: Queue,
    @InjectQueue('process_video_480p') private videoProcessQueue480p: Queue,
    @InjectQueue('process_video_540p') private videoProcessQueue540p: Queue,
    @InjectQueue('process_video_720p') private videoProcessQueue720p: Queue,
    @InjectQueue('validate-video') private validateVideoQueue: Queue,
    @InjectQueue('thumbnail-generation') private thumbnailGenerationQueue: Queue,
    @InjectQueue('download-video') private downloadVideoQueue: Queue
  ) {}

  async create(createVideoInput: CreateAssetInputDto, userDocument: UserDocument) {
    let assetDocument = AssetMapper.buildAssetDocumentForSaving(createVideoInput, userDocument);
    return this.repository.create(assetDocument);
  }

  async createAssetFromUploadReq(uploadAssetReqDto: CreateAssetFromUploadInputDto, userDocument: UserDocument) {
    let assetDocument = AssetMapper.buildAssetDocumentFromUploadReq(uploadAssetReqDto, userDocument);
    return this.repository.create(assetDocument);
  }

  async listVideos(listVideoInputDto: ListAssetInputDto, user: UserDocument) {
    return this.repository.getPaginatedVideos(
      listVideoInputDto.first,
      listVideoInputDto.after,
      listVideoInputDto.before,
      user
    );
  }

  async getAsset(getVideoInputDto: GetAssetInputDto, userDocument: UserDocument) {
    return this.repository.findOne({
      _id: getVideoInputDto._id,
      user_id: userDocument._id,
    });
  }

  async update(oldVideo: AssetDocument, updateVideoInput: UpdateAssetInputDto) {
    await this.repository.findOneAndUpdate(
      { _id: oldVideo._id },
      {
        title: updateVideoInput.title ? updateVideoInput.title : oldVideo.title,
        description: updateVideoInput.description ? updateVideoInput.description : updateVideoInput.description,
        tags: updateVideoInput.tags ? updateVideoInput.tags : oldVideo.tags,
      }
    );
    return this.repository.findOne({ _id: oldVideo._id });
  }

  async softDeleteVideo(currentVideo: AssetDocument) {
    await this.repository.findOneAndUpdate(
      { _id: currentVideo._id },
      {
        is_deleted: true,
      }
    );
    return this.repository.findOne({ _id: currentVideo._id });
  }

  async updateAssetStatus(videoId: string, status: string, details: string) {
    return this.repository.findOneAndUpdate(
      {
        _id: mongoose.Types.ObjectId(videoId),
        latest_status: {
          $ne: status,
        },
      },
      {
        latest_status: status,
        $push: {
          status_logs: {
            status: status,
            details: details,
          },
        },
      }
    );
  }

  async pushDownloadVideoJob(videoDocument: AssetDocument) {
    await this.updateAssetStatus(
      videoDocument._id.toString(),
      Constants.VIDEO_STATUS.DOWNLOADING,
      'Downloading assets'
    );
    let downloadVideoJob = this.buildDownloadVideoJob(videoDocument);
    console.log('pubsh download video job to ', AppConfigService.appConfig.BULL_DOWNLOAD_JOB_QUEUE);
    return this.downloadVideoQueue.add(AppConfigService.appConfig.BULL_DOWNLOAD_JOB_QUEUE, downloadVideoJob, {
      jobId: videoDocument._id.toString(),
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async pushValidateVideoJob(assetId: string) {
    let validateVideoJob = this.buildValidateVideoJob(assetId);
    return this.validateVideoQueue.add(AppConfigService.appConfig.BULL_VALIDATE_JOB_QUEUE, validateVideoJob);
  }

  private buildDownloadVideoJob(videoDocument: AssetDocument): Models.VideoDownloadJobModel {
    return {
      asset_id: videoDocument._id.toString(),
      source_url: videoDocument.source_url,
    };
  }

  private buildValidateVideoJob(assetId: string): Models.VideoValidationJobModel {
    return {
      asset_id: assetId,
    };
  }

  deleteLocalAssetFile(_id: string) {
    console.log('deleting local asset file ', _id);
    let localPath = Utils.getLocalVideoRootPath(_id, AppConfigService.appConfig.TEMP_VIDEO_DIRECTORY);
    console.log('local path ', localPath);
    if (fs.existsSync(localPath)) {
      fs.rmSync(localPath, { recursive: true, force: true });
    }
  }

  async checkForDeleteLocalAssetFile(assetId: string) {
    console.log('checking for ', assetId);
    let files = await this.fileRepository.find({
      asset_id: mongoose.Types.ObjectId(assetId),
    });
    let filesWithReadyStatus = files.filter((file) => file.latest_status === Constants.FILE_STATUS.READY);

    console.log('length ', files.length, filesWithReadyStatus.length);
    if (files.length === filesWithReadyStatus.length) {
      this.deleteLocalAssetFile(assetId);
    }
  }

  async checkForAssetFailedStatus(assetId: string) {
    try {
      let notFailedFilesCount = await this.fileRepository.count({
        asset_id: mongoose.Types.ObjectId(assetId),
        latest_status: {
          $ne: Constants.FILE_STATUS.FAILED,
        },
      });

      if (notFailedFilesCount > 0) {
        return;
      }

      let files = await this.fileRepository.find({
        asset_id: mongoose.Types.ObjectId(assetId),
      });

      let failedFiles = files.filter((file) => file.latest_status === Constants.FILE_STATUS.FAILED);
      if (failedFiles.length === files.length) {
        console.log('all files failed');
        await this.updateAssetStatus(assetId, Constants.VIDEO_STATUS.FAILED, 'All files failed');
      }
    } catch (err) {
      console.log('error while checkForAssetFailedStatus ', err);
    }
  }

  async afterUpdateLatestStatus(oldDoc: AssetDocument) {
    let updatedAsset = await this.repository.findOne({
      _id: mongoose.Types.ObjectId(oldDoc._id.toString()),
    });

    if (updatedAsset.latest_status === Constants.VIDEO_STATUS.FAILED) {
      this.deleteLocalAssetFile(updatedAsset._id.toString());
    }
    if (
      updatedAsset.latest_status === Constants.VIDEO_STATUS.DOWNLOADED ||
      updatedAsset.latest_status === Constants.VIDEO_STATUS.UPLOADED
    ) {
      console.log('pushing validate assets job 1 ...');
      this.pushValidateVideoJob(updatedAsset._id.toString())
        .then(() => {
          console.log('pushed validate assets job');
        })
        .catch((err) => {
          console.log('error pushing validate assets job', err);
        });
    }
    if (updatedAsset.latest_status === Constants.VIDEO_STATUS.VALIDATED) {
      let heightWidthMapByHeight = this.jobManagerService.getAllHeightWidthMapByHeight(updatedAsset.height);
      let files = await this.insertFilesData(updatedAsset._id.toString(), heightWidthMapByHeight);
      let jobModels = this.jobManagerService.getJobData(updatedAsset._id.toString(), files);
      await this.updateAssetStatus(updatedAsset._id.toString(), Constants.VIDEO_STATUS.PROCESSING, 'Video processing');
      this.publishVideoProcessingJob(updatedAsset._id.toString(), jobModels);
      await this.initThumbnailGeneration(updatedAsset._id.toString(), updatedAsset.height, updatedAsset.width);
    }
  }

  async afterSave(doc: AssetDocument) {
    if (doc.source_url) {
      this.pushDownloadVideoJob(doc)
        .then(() => {
          console.log('pushed download assets job');
        })
        .catch((err) => {
          console.log('error pushing download assets job', err);
        });
    }
  }

  async publishVideoProcessingJob(assetId: string, jobMetadata: Models.JobMetadataModel[]) {
    for (let data of jobMetadata) {
      let jobModel: Models.VideoProcessingJobModel = {
        asset_id: assetId,
        file_id: data.file_id.toString(),
        height: data.height,
        width: data.width,
      };
      console.log('publishing video processing job for ', data.processRoutingKey, jobModel);
      if (jobModel.height === 360) {
        await this.videoProcessQueue360p.add(data.processRoutingKey, jobModel);
      } else if (jobModel.height === 480) {
        await this.videoProcessQueue480p.add(data.processRoutingKey, jobModel);
      } else if (jobModel.height === 540) {
        await this.videoProcessQueue540p.add(data.processRoutingKey, jobModel);
      } else if (jobModel.height === 720) {
        await this.videoProcessQueue720p.add(data.processRoutingKey, jobModel);
      }
    }
  }

  private async insertFilesData(assetId: string, heightWidthMaps: HeightWidthMap[]) {
    let files: FileDocument[] = [];
    for (let data of heightWidthMaps) {
      let newFiles = await this.createFileAfterValidation(assetId, data.height, data.width);
      files.push(newFiles);
    }
    return files;
  }

  async createFileAfterValidation(assetId: string, height: number, width: number) {
    let name = Utils.getFileName(height);
    let doc = FileMapper.mapForSave(
      assetId,
      name,
      Constants.FILE_TYPE.PLAYLIST,
      height,
      width,
      Constants.FILE_STATUS.QUEUED,
      'File queued for processing'
    );
    return this.fileRepository.create(doc);
  }

  async checkForAssetReadyStatus(assetId: string) {
    let video = await this.repository.findOne({
      _id: mongoose.Types.ObjectId(assetId),
    });

    if (!video) {
      throw new Error('video not found');
    }

    if (video.latest_status !== Constants.VIDEO_STATUS.READY) {
      await this.updateAssetStatus(assetId, Constants.VIDEO_STATUS.READY, 'Video ready');
    }
  }

  async updateMasterFileVersion(assetId: string) {
    let readyFileCount = await this.fileRepository.count({
      asset_id: mongoose.Types.ObjectId(assetId),
      type: Constants.FILE_TYPE.PLAYLIST,
      latest_status: Constants.FILE_STATUS.READY,
    });

    if (readyFileCount === 0) {
      return null;
    }

    let master_file_name = `${Utils.getMainManifestFileName()}?v=${readyFileCount}`;
    return this.repository.findOneAndUpdate(
      {
        _id: mongoose.Types.ObjectId(assetId),
      },
      {
        master_file_name: master_file_name,
      }
    );
  }

  private publishThumbnailGenerationJob(assetId: string, fileId: string) {
    let thumbnailGenerationJob: Models.ThumbnailGenerationJobModel = {
      asset_id: assetId,
      file_id: fileId,
    };
    return this.thumbnailGenerationQueue.add(
      AppConfigService.appConfig.BULL_THUMBNAIL_GENERATION_JOB_QUEUE,
      thumbnailGenerationJob
    );
  }

  private async initThumbnailGeneration(assetId: string, height: number, width: number) {
    let thumbnailName = Utils.getThumbnailFileName();
    let fileToBeSaved = FileMapper.mapForSave(
      assetId,
      thumbnailName,
      Constants.FILE_TYPE.THUMBNAIL,
      height,
      width,
      Constants.FILE_STATUS.QUEUED,
      'Thumbnail queued for processing'
    );
    let thumbnailFile = await this.fileRepository.create(fileToBeSaved);
    this.publishThumbnailGenerationJob(assetId, thumbnailFile._id.toString());
  }
}
