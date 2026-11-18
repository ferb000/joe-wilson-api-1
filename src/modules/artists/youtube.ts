const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** Only recognized YouTube hosts and video paths are accepted. Never embed user URLs. */
export function parseYouTubeId(input: string): string | null {
  const value = input.trim();
  if (videoIdPattern.test(value)) return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let id: string | null = null;
    if (url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be') {
      if (parts.length === 1) id = parts[0];
    } else if (youtubeHosts.has(url.hostname)) {
      if (url.pathname === '/watch') id = url.searchParams.get('v');
      else if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0])) id = parts[1];
    } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname) && parts.length === 2 && parts[0] === 'embed') id = parts[1];
    return id && videoIdPattern.test(id) ? id : null;
  } catch { return null; }
}

export function youtubeThumbnail(input: string): string | null {
  const id = parseYouTubeId(input);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
export function youtubeEmbed(input: string, autoplay = true): string | null {
  const id = parseYouTubeId(input);
  return id ? `https://www.youtube-nocookie.com/embed/${id}?autoplay=${autoplay ? 1 : 0}&rel=0` : null;
}
export function isHttpsImageUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}
