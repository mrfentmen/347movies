/**
 * YouTube Data API v3 search client for the Short Films page (/shortfilms).
 *
 * The site's trust model extends to YouTube the same way it does to archive.org: the
 * search is filtered to Creative Commons-licensed, embeddable videos
 * (videoLicense=creativeCommon, videoEmbeddable=true), so every embed is legally
 * reusable content — never a pirated rip. Medium-length results (4–20 min, the
 * short-film sweet spot; YouTube's buckets are short <4m / medium 4–20m / long >20m)
 * and strict-safe results are returned. Dormant until YOUTUBE_API_KEY is configured:
 * the endpoint returns { enabled:false } and the page renders an honest pending state
 * instead of a broken embed grid.
 */
export interface YoutubeVideo {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  embedUrl: string;
  publishedAt: string;
}

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

/**
 * Search YouTube for CC-licensed, embeddable, medium-length videos. Returns an empty
 * array on any upstream failure (quota, bad request, network) — the page shows a
 * graceful error state, never a broken grid.
 */
export async function searchCreativeCommonsVideos(
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YoutubeVideo[]> {
  const url = new URL(YOUTUBE_SEARCH_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoDuration", "medium");
  url.searchParams.set("videoLicense", "creativeCommon");
  url.searchParams.set("videoEmbeddable", "true");
  url.searchParams.set("safeSearch", "strict");
  url.searchParams.set("maxResults", "24");
  url.searchParams.set("q", query);
  url.searchParams.set("key", apiKey);

  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(15000) });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const body = (await res.json().catch(() => null)) as {
    items?: Array<{
      id?: { videoId?: string };
      snippet?: {
        title?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: { medium?: { url?: string } };
      };
    }>;
  } | null;
  if (!body || !Array.isArray(body.items)) return [];

  const videos: YoutubeVideo[] = [];
  for (const item of body.items) {
    const id = item?.id?.videoId;
    if (!id) continue;
    videos.push({
      id,
      title: item?.snippet?.title ?? id,
      channel: item?.snippet?.channelTitle ?? "",
      thumbnail: item?.snippet?.thumbnails?.medium?.url ?? "",
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
      publishedAt: item?.snippet?.publishedAt ?? "",
    });
  }
  return videos;
}
