import { prisma } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { claimVideoJob, processVideoJob } from '../modules/media/transcoding/processor';
import { runProcess } from '../modules/media/transcoding/ffmpeg';

const shutdown = new AbortController();
let wake: (() => void) | undefined;
function stop() { shutdown.abort(); wake?.(); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

async function main() {
  if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required by the video worker');
  // Fail at startup if the deployment omitted the transcoder or encoder.
  await runProcess(env.FFMPEG_PATH, ['-version'], shutdown.signal, 10000);
  await runProcess(env.FFPROBE_PATH, ['-version'], shutdown.signal, 10000);
  const encoders = await runProcess(env.FFMPEG_PATH, ['-hide_banner', '-encoders'], shutdown.signal, 10000);
  if (!encoders.includes('libx264')) throw new Error('FFmpeg must include libx264');
  logger.info('Video worker started; processing one video at a time');
  while (!shutdown.signal.aborted) {
    try {
      const job = await claimVideoJob();
      if (job) { await processVideoJob(job, shutdown.signal); continue; }
    } catch { logger.error('Video job polling failed; will retry'); }
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 5000); wake = () => { clearTimeout(timer); resolve(); }; });
    wake = undefined;
  }
}

main().catch(() => { logger.error('Video worker failed; check database, S3 and FFmpeg configuration'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
