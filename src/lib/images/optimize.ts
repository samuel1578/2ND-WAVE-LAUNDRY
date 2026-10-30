const MAX_EDGE = 2000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const SKIP_OPTIMIZATION_BYTES = 1.5 * 1024 * 1024;

/** Compress a marketing image in-browser while keeping the selected original
 * untouched for its local preview. WebP retains alpha transparency. */
export async function optimizeImage(file: File): Promise<File> {
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        const longestEdge = Math.max(bitmap.width, bitmap.height);
        if (file.size <= SKIP_OPTIMIZATION_BYTES && longestEdge <= MAX_EDGE) {
            return file;
        }

        const scale = Math.min(1, MAX_EDGE / longestEdge);
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image optimization is unavailable.");
        context.drawImage(bitmap, 0, 0, width, height);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (result) =>
                    result ? resolve(result) : reject(new Error("Image optimization failed.")),
                "image/webp",
                0.85,
            );
        });
        if (blob.type !== "image/webp") {
            throw new Error("WebP image optimization is unavailable.");
        }
        if (blob.size > file.size) return file;

        const name = `${file.name.replace(/\.[^.]*$/, "") || "image"}.webp`;
        return new File([blob], name, { type: "image/webp", lastModified: file.lastModified });
    } catch (error) {
        if (file.size <= MAX_UPLOAD_BYTES) return file;
        throw new Error(
            "The image could not be optimized and is larger than the 4 MB upload limit.",
            { cause: error },
        );
    } finally {
        bitmap?.close();
    }
}
