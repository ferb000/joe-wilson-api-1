import { spawn } from 'child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { env } from '../../../config/env';

export class TranscodeError extends Error {
  constructor(public code: string) { super(code); }
}

export interface VideoInfo { width: number; height: number; durationSeconds: number; videoIndex: number }
export interface Rendition { name: string; width: number; height: number; bitrate: number }

// Never invoke a shell or pass cloud credentials to the media parser.
export function runProcess(binary: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new TranscodeError('ABORTED'));
    const child = spawn(binary, args, {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP },
    });
    let output = '';
    let failure: TranscodeError | undefined;
    const stop = (code: string) => { failure ||= new TranscodeError(code); child.kill('SIGKILL'); };
    const abort = () => stop('ABORTED');
    const timer = setTimeout(() => stop('PROCESS_TIMEOUT'), timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 2 * 1024 * 1024) stop('PROCESS_OUTPUT_LIMIT');
    });
    // Drain stderr without retaining parser diagnostics or paths in application logs.
    child.stderr.resume();
    const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    child.on('error', () => { clean(); reject(new TranscodeError('BINARY_UNAVAILABLE')); });
    child.on('close', code => {
      clean();
      if (failure) reject(failure);
      else if (code !== 0) reject(new TranscodeError('PROCESS_FAILED'));
      else resolve(output);
    });
  });
}

const inputRestrictions = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mpegts,mpeg,ogg'];

export async function probeVideo(source: string, signal: AbortSignal): Promise<VideoInfo> {
  const raw = await runProcess(env.FFPROBE_PATH, [
    '-v', 'error', ...inputRestrictions, '-show_streams', '-show_format', '-of', 'json', source,
  ], signal, 30000);
  let data;
  try { data = JSON.parse(raw); } catch { throw new TranscodeError('INVALID_VIDEO'); }
  const stream = data.streams?.find((s: { codec_type?: string; disposition?: { attached_pic?: number } }) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const durationSeconds = Number(data.format?.duration ?? stream?.duration);
  let width = Number(stream?.width), height = Number(stream?.height);
  const [sarWidth, sarHeight] = String(stream?.sample_aspect_ratio || '1:1').split(':').map(Number);
  if (Number.isFinite(sarWidth / sarHeight) && sarWidth > 0 && sarHeight > 0) width = Math.round(width * sarWidth / sarHeight);
  const rotation = Number(stream?.side_data_list?.find((s: { rotation?: number }) => s.rotation !== undefined)?.rotation || 0);
  if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 7680 || height > 7680 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > env.VIDEO_MAX_DURATION_SECONDS) {
    throw new TranscodeError('VIDEO_LIMIT_EXCEEDED');
  }
  return { width, height, durationSeconds, videoIndex: stream.index };
}

export function chooseRenditions(info: VideoInfo): Rendition[] {
  const maximum = Math.min(1080, Math.floor(info.height / 2) * 2);
  const heights = [...new Set([360, 720, 1080, maximum].filter(h => h <= maximum))].sort((a, b) => a - b);
  return heights.map(height => {
    const width = Math.max(2, Math.floor(Math.min(info.width, 1920, info.width * height / info.height) / 2) * 2);
    // A width cap must preserve aspect ratio too (e.g. ultrawide sources).
    const actualHeight = Math.max(2, Math.floor(Math.min(height, info.height * width / info.width) / 2) * 2);
    return { name: `${height}p`, width, height: actualHeight, bitrate: height <= 360 ? 800 : height <= 720 ? 2500 : 4500 };
  });
}

export function renditionArguments(source: string, directory: string, info: VideoInfo, rendition: Rendition): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...inputRestrictions,
    '-threads', String(env.VIDEO_TRANSCODE_THREADS), '-i', source,
    '-map', `0:${info.videoIndex}`, '-map', '0:a:0?', '-sn', '-dn', '-map_metadata', '-1',
    '-vf', `scale=${rendition.width}:${rendition.height},setsar=1`, '-r', '30',
    '-c:v', 'libx264', '-preset', 'fast', '-profile:v', 'main', '-pix_fmt', 'yuv420p',
    '-threads', String(env.VIDEO_TRANSCODE_THREADS), '-b:v', `${rendition.bitrate}k`,
    '-maxrate', `${Math.ceil(rendition.bitrate * 1.15)}k`, '-bufsize', `${rendition.bitrate * 2}k`,
    '-flags', '+cgop', '-g', '180', '-keyint_min', '180', '-sc_threshold', '0',
    '-force_key_frames', 'expr:gte(t,n_forced*6)',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
    '-hls_flags', 'independent_segments', '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', join(directory, 'segment_%06d.ts'), join(directory, 'index.m3u8'),
  ];
}

export async function outputFiles(directory: string, base = ''): Promise<{ path: string; relative: string; size: number }[]> {
  const files: { path: string; relative: string; size: number }[] = [];
  for (const entry of await readdir(join(directory, base), { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new TranscodeError('INVALID_OUTPUT');
    if (entry.isDirectory()) files.push(...await outputFiles(directory, relative));
    else if (entry.isFile()) files.push({ path: join(directory, relative), relative, size: (await stat(join(directory, relative))).size });
  }
  return files;
}

export async function transcodeVideo(source: string, output: string, signal: AbortSignal) {
  const info = await probeVideo(source, signal);
  const renditions = chooseRenditions(info);
  await mkdir(output, { recursive: true });
  for (const rendition of renditions) {
    const directory = join(output, rendition.name);
    await mkdir(directory, { recursive: true });
    await runProcess(env.FFMPEG_PATH, renditionArguments(source, directory, info, rendition), signal, env.VIDEO_TRANSCODE_TIMEOUT_SECONDS * 1000);
    const manifest = await readFile(join(directory, 'index.m3u8'), 'utf8');
    if (!manifest.includes('#EXT-X-ENDLIST')) throw new TranscodeError('INVALID_OUTPUT');
  }
  const master = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (const rendition of renditions) {
    master.push(`#EXT-X-STREAM-INF:BANDWIDTH=${Math.ceil(rendition.bitrate * 1150 + 160000)},RESOLUTION=${rendition.width}x${rendition.height}`, `${rendition.name}/index.m3u8`);
  }
  await writeFile(join(output, 'master.m3u8'), master.join('\n') + '\n');
  return { info, renditions };
}
