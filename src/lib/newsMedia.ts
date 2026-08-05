// What a news article is allowed to carry, and why the limits are where they are.
//
// These MUST agree with the news-media storage bucket, which enforces the same mime
// list and the same 50MB ceiling server-side. The copies here exist to fail fast in
// the browser with a sentence a person can act on, rather than after a 50MB upload
// comes back as a bare 413.

export const ACCEPTED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
export const ACCEPTED_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime']

/** 10MB a photo — well past what any reasonable JPEG needs. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/**
 * 50MB a video. This is a BANDWIDTH limit, not a storage one: storage is cheap, but
 * a 500MB file re-served to sixty members on every page load is not. 50MB is roughly
 * a minute or two of 1080p — the highlight clip people actually want — and anything
 * longer belongs on YouTube, which is what an embed is for.
 */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024

export const ACCEPTED_ALL = [...ACCEPTED_IMAGE, ...ACCEPTED_VIDEO]

export const isImage = (mime: string) => ACCEPTED_IMAGE.includes(mime)
export const isVideo = (mime: string) => ACCEPTED_VIDEO.includes(mime)

export function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/**
 * Why this file can't be attached, or null if it can. Returns the sentence shown to
 * the person — including what to do instead, because "invalid file" tells nobody
 * anything.
 */
export function rejectReason(file: File): string | null {
  const mime = file.type
  if (!ACCEPTED_ALL.includes(mime)) {
    // A .mov from a phone sometimes arrives with an empty type; say so plainly
    // rather than claiming the format is unsupported.
    return mime
      ? `${file.name} is a ${mime} file. Attach a PNG, JPEG, WebP, GIF, MP4, WebM or MOV.`
      : `${file.name} arrived without a file type, so it can't be checked. Re-export it as MP4 or JPEG.`
  }
  if (isImage(mime) && file.size > MAX_IMAGE_BYTES) {
    return `${file.name} is ${prettyBytes(file.size)} — photos cap at ${prettyBytes(MAX_IMAGE_BYTES)}. Resize it and try again.`
  }
  if (isVideo(mime) && file.size > MAX_VIDEO_BYTES) {
    return (
      `${file.name} is ${prettyBytes(file.size)} — video caps at ${prettyBytes(MAX_VIDEO_BYTES)} so the page stays quick to load. ` +
      `Trim it, export at 720p, or upload it to YouTube and paste the link instead.`
    )
  }
  return null
}

/** Storage key for an upload: unique, and safe to sit in a URL. */
export function storageKey(newsId: string, file: File): string {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60)
  return `${newsId}/${crypto.randomUUID()}-${safe}`
}
