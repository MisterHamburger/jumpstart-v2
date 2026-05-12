/**
 * Compress a photo file to a base64 JPEG string.
 * Returns a data URL (data:image/jpeg;base64,...).
 * Call .split(',')[1] to get raw base64 for Supabase storage.
 */
export function compressPhoto(file, { maxWidth = 1200, quality = 0.7 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, maxWidth / img.width)
        canvas.width = img.width * scale
        canvas.height = img.height * scale
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const dataUrl = canvas.toDataURL('image/jpeg', quality)
        URL.revokeObjectURL(img.src)
        resolve(dataUrl)
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Strip data URL prefix to get raw base64 for DB storage.
 */
export function toBase64(dataUrl) {
  return dataUrl.split(',')[1]
}

/**
 * Upload a base64 dataURL or plain base64 string to the Supabase Storage
 * 'kickstart-photos' bucket and return the public URL.
 *
 * Path format: `${intakeId}.jpg`. Uses upsert so a re-upload overwrites.
 *
 * @param {object} supabase - Supabase client instance
 * @param {number} intakeId - kickstart_intake.id, used as the filename
 * @param {string} input - data URL (data:image/jpeg;base64,...) OR raw base64
 */
export async function uploadKickstartPhoto(supabase, intakeId, input) {
  if (!input) throw new Error('No photo data')
  const base64 = input.includes(',') ? input.split(',')[1] : input
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: 'image/jpeg' })

  const path = `${intakeId}.jpg`
  const { error } = await supabase.storage
    .from('kickstart-photos')
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw error

  const { data } = supabase.storage.from('kickstart-photos').getPublicUrl(path)
  return data.publicUrl
}
