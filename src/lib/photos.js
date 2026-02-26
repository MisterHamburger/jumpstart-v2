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
