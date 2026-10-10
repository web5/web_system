import { COLLAB_HTTP } from '../config'

export interface SavedDoc {
  content: string
  savedAt: number
}

export async function loadDoc(docId: string): Promise<SavedDoc> {
  try {
    const r = await fetch(`${COLLAB_HTTP}/doc/${encodeURIComponent(docId)}`)
    if (!r.ok) return { content: '', savedAt: 0 }
    return (await r.json()) as SavedDoc
  } catch {
    return { content: '', savedAt: 0 }
  }
}

export async function saveDoc(
  docId: string,
  content: string,
): Promise<{ ok: boolean; savedAt: number }> {
  const r = await fetch(`${COLLAB_HTTP}/doc/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docId, content }),
  })
  return await r.json()
}
