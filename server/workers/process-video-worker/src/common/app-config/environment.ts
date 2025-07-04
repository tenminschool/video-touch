export interface EnvironmentVariables {
  PROCESS_VIDEO_WORKER_PORT: number;
  RABBIT_MQ_VIDEO_TOUCH_TOPIC_EXCHANGE: string;
  RABBIT_MQ_UPDATE_FILE_STATUS_ROUTING_KEY: string;
  RABBIT_MQ_URL: string;
  TEMP_VIDEO_DIRECTORY: string;
  BULL_PROCESS_VIDEO_JOB_QUEUE: string;
  BULL_UPLOAD_JOB_QUEUE: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
}
