import { AppError } from './errors';

// A participant's attached picture, sent as a data URL. The client shrinks it to at most 1024px
// before sending, so a real one is a few hundred KB; the cap only stops abuse.
export const MESSAGE_IMAGE_PATTERN = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MESSAGE_IMAGE_MAX_CHARS = 8_000_000;

// Undefined when nothing was attached. A malformed or oversized picture is refused, not dropped:
// the participant would otherwise get a reply that ignores what they sent.
export const messageImageOf = (value: unknown): string | undefined => {
    if (value == null || value === '') return undefined;
    if (typeof value !== 'string' || value.length > MESSAGE_IMAGE_MAX_CHARS || !MESSAGE_IMAGE_PATTERN.test(value)) {
        throw new AppError('The attached image could not be read. Please try a different picture.', 400, 'INVALID_IMAGE');
    }
    return value;
};

// Splits a data URL into its media type and base64 body (Anthropic and Gemini want them apart).
export const splitDataUrl = (dataUrl: string): { mediaType: string; data: string } => {
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    return { mediaType: match?.[1] ?? 'image/jpeg', data: match?.[2] ?? '' };
};
