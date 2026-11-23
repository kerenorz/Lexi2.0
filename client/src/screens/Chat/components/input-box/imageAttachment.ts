// Shrinks a picture the participant picked before it is sent. Phone photos are often 5-10 MB;
// the model gains nothing past ~1024px, and every later turn re-sends the picture.
export const IMAGE_MAX_SIDE_PX = 1024;
export const IMAGE_JPEG_QUALITY = 0.85;

const readAsDataUrl = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The picture could not be read.'));
        img.src = src;
    });

// Data URL (JPEG) no larger than IMAGE_MAX_SIDE_PX on its long side. Rejects non-images.
export const prepareImageAttachment = async (file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) {
        throw new Error('Please choose a picture.');
    }
    const original = await readAsDataUrl(file);
    const img = await loadImage(original);

    const scale = Math.min(1, IMAGE_MAX_SIDE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return original;
    // White under transparent PNGs, which JPEG would otherwise turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
};
