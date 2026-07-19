// Turn a pasted clip URL into an embeddable player URL. Supports the hosts sim
// racers actually use; anything else falls back to a plain link.

export interface EmbedInfo {
  kind: 'youtube' | 'twitch' | 'streamable' | 'medal' | 'other'
  embedUrl: string | null
  label: string
}

export function parseClipUrl(raw: string): EmbedInfo {
  const url = raw.trim()
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')

    // YouTube — watch?v=, youtu.be/, /shorts/
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
      let id = ''
      if (host === 'youtu.be') id = u.pathname.slice(1)
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] ?? ''
      else id = u.searchParams.get('v') ?? ''
      const t = u.searchParams.get('t')?.replace(/[^0-9]/g, '')
      if (id) {
        return {
          kind: 'youtube',
          embedUrl: `https://www.youtube.com/embed/${id}${t ? `?start=${t}` : ''}`,
          label: 'YouTube clip',
        }
      }
    }

    // Twitch clips
    if (host === 'twitch.tv' || host === 'clips.twitch.tv') {
      const slug = host === 'clips.twitch.tv' ? u.pathname.slice(1) : u.pathname.split('/clip/')[1]
      if (slug) {
        return {
          kind: 'twitch',
          embedUrl: `https://clips.twitch.tv/embed?clip=${slug}&parent=${window.location.hostname}`,
          label: 'Twitch clip',
        }
      }
    }

    // Streamable
    if (host === 'streamable.com') {
      const id = u.pathname.slice(1)
      if (id) return { kind: 'streamable', embedUrl: `https://streamable.com/e/${id}`, label: 'Streamable clip' }
    }

    // Medal.tv
    if (host === 'medal.tv') {
      const id = u.pathname.split('/clips/')[1]?.split('/')[0]
      if (id) return { kind: 'medal', embedUrl: `https://medal.tv/clip/${id}/embed`, label: 'Medal clip' }
    }

    return { kind: 'other', embedUrl: null, label: host }
  } catch {
    return { kind: 'other', embedUrl: null, label: 'Link' }
  }
}

export const ACCEPTED_IMAGE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024 // 5MB per screenshot
