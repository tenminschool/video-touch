export interface EnvironmentVariables {
  THUMBNAIL_WORKER_PORT: number;
  RABBIT_MQ_VIDEO_TOUCH_TOPIC_EXCHANGE: string;
  RABBIT_MQ_UPDATE_FILE_STATUS_ROUTING_KEY: string;
  RABBIT_MQ_URL: string;
  TEMP_VIDEO_DIRECTORY: string;
  BULL_THUMBNAIL_GENERATION_JOB_QUEUE: string;
  AWS_REGION: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_S3_BUCKET_NAME: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
}
