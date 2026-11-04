"use client";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Field, TextField } from "@/components/forms/controls";
import type {
  BlogContentBlock,
  BlogImageAlign,
  BlogImageBlock,
  BlogImageSize,
  BlogTextStyle,
  MediaAsset,
} from "@/lib/contracts";
import {
  isBlogImageAlign,
  isBlogImageSize,
} from "@/lib/website/blog-blocks";

const TEXT_STYLES: { style: BlogTextStyle; label: string }[] = [
  { style: "paragraph", label: "Paragraph" },
  { style: "heading2", label: "Heading" },
  { style: "heading3", label: "Subheading" },
  { style: "bulleted", label: "Bulleted list" },
  { style: "numbered", label: "Numbered list" },
];

const ALIGNMENTS: { align: BlogImageAlign; label: string }[] = [
  { align: "left", label: "Left" },
  { align: "center", label: "Center" },
  { align: "right", label: "Right" },
];

const SIZES: { size: BlogImageSize; label: string }[] = [
  { size: "small", label: "Small" },
  { size: "medium", label: "Medium" },
  { size: "large", label: "Large" },
  { size: "full", label: "Full width" },
];

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "BLOCKQUOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textLinesHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

function figureHtml(block: BlogImageBlock): string {
  const align = block.align ?? "center";
  const size = block.size ?? "full";
  const caption = block.caption.trim()
    ? `<figcaption>${escapeHtml(block.caption)}</figcaption>`
    : "";
  return (
    `<figure class="blog-figure blog-figure--${align} blog-figure--${size}"` +
    ` contenteditable="false" tabindex="0" role="group" aria-label="Article image"` +
    ` data-media-id="${escapeHtml(block.mediaId)}" data-src="${escapeHtml(block.src)}"` +
    ` data-alt="${escapeHtml(block.alt)}" data-align="${align}" data-size="${size}">` +
    `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" loading="lazy" />` +
    `${caption}</figure>`
  );
}

/** Serializes blocks into the editable canvas, preserving reading order. */
function blocksToHtml(blocks: BlogContentBlock[]): string {
  let html = "";
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type === "image") {
      html += figureHtml(block);
      index += 1;
      continue;
    }
    const style = block.style ?? "paragraph";
    if (style === "bulleted" || style === "numbered") {
      const tag = style === "bulleted" ? "ul" : "ol";
      const items: string[] = [];
      while (index < blocks.length) {
        const item = blocks[index];
        if (item.type !== "text" || (item.style ?? "paragraph") !== style) break;
        items.push(`<li>${item.text.trim() ? textLinesHtml(item.text) : "<br>"}</li>`);
        index += 1;
      }
      html += `<${tag}>${items.join("")}</${tag}>`;
      continue;
    }
    const tag = style === "heading2" ? "h2" : style === "heading3" ? "h3" : "p";
    html += `<${tag}>${block.text.trim() ? textLinesHtml(block.text) : "<br>"}</${tag}>`;
    index += 1;
  }
  return html;
}

function textBlock(text: string, style: BlogTextStyle, order: number): BlogContentBlock {
  return {
    type: "text",
    text,
    order,
    ...(style === "paragraph" ? {} : { style }),
  };
}

function imageBlockFromElement(element: Element, order: number): BlogImageBlock | undefined {
  const image = element.querySelector("img");
  const src = element.getAttribute("data-src") || image?.getAttribute("src") || "";
  if (!src) return undefined;
  const align = element.getAttribute("data-align");
  const size = element.getAttribute("data-size");
  return {
    type: "image",
    mediaId: element.getAttribute("data-media-id") ?? "",
    src,
    alt: element.getAttribute("data-alt") ?? image?.getAttribute("alt") ?? "",
    caption: element.querySelector("figcaption")?.textContent ?? "",
    order,
    ...(isBlogImageAlign(align) ? { align } : {}),
    ...(isBlogImageSize(size) ? { size } : {}),
  };
}

function collectList(element: Element, out: BlogContentBlock[]) {
  const style: BlogTextStyle = element.tagName === "OL" ? "numbered" : "bulleted";
  for (const child of Array.from(element.children)) {
    if (child.tagName === "LI") {
      collectNodes(Array.from(child.childNodes), out, style);
    } else if (child.tagName === "UL" || child.tagName === "OL") {
      collectList(child, out);
    } else {
      collectElement(child, out);
    }
  }
}

function collectElement(element: Element, out: BlogContentBlock[]) {
  const tag = element.tagName;
  if (tag === "FIGURE") {
    const image = imageBlockFromElement(element, out.length + 1);
    if (image) out.push(image);
    return;
  }
  if (tag === "UL" || tag === "OL") {
    collectList(element, out);
    return;
  }
  if (tag === "H1" || tag === "H2") {
    collectNodes(Array.from(element.childNodes), out, "heading2");
    return;
  }
  if (tag === "H3" || tag === "H4" || tag === "H5" || tag === "H6") {
    collectNodes(Array.from(element.childNodes), out, "heading3");
    return;
  }
  collectNodes(Array.from(element.childNodes), out, "paragraph");
}

/**
 * Walks an editable container and rebuilds the block document. Figures are
 * atomic, so a paragraph split around an inline image becomes the matching
 * text/image/text blocks in order.
 */
function collectNodes(nodes: Node[], out: BlogContentBlock[], style: BlogTextStyle) {
  let buffer = "";
  const flush = (force: boolean) => {
    if (!buffer.trim() && !force) {
      buffer = "";
      return;
    }
    out.push(textBlock(buffer.replace(/\u00a0/g, " "), style, out.length + 1));
    buffer = "";
  };
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      buffer += node.textContent ?? "";
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === "FIGURE") {
      flush(false);
      const image = imageBlockFromElement(element, out.length + 1);
      if (image) out.push(image);
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      flush(false);
      collectList(element, out);
      continue;
    }
    if (tag === "BR") {
      buffer += "\n";
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      flush(false);
      collectElement(element, out);
      continue;
    }
    buffer += element.textContent ?? "";
  }
  flush(true);
}

function parseBlocks(root: HTMLElement): BlogContentBlock[] {
  const out: BlogContentBlock[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (text.trim()) out.push(textBlock(text.trim(), "paragraph", out.length + 1));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    collectElement(node as Element, out);
  }
  return out.map(
    (block, index) => ({ ...block, order: index + 1 }) as BlogContentBlock,
  );
}

function selectionInside(root: HTMLElement): Range | undefined {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : undefined;
}

function topLevelElement(root: HTMLElement, node: Node): Element | undefined {
  let current: Node | null = node;
  while (current && current !== root && current.parentNode !== root) {
    current = current.parentNode;
  }
  return current && current !== root && current instanceof Element
    ? current
    : undefined;
}

function placeCaret(element: HTMLElement) {
  const caret = document.createRange();
  caret.selectNodeContents(element);
  caret.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(caret);
}

function createFigure(asset: MediaAsset): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "blog-figure blog-figure--center blog-figure--large";
  figure.setAttribute("contenteditable", "false");
  figure.setAttribute("tabindex", "0");
  figure.setAttribute("role", "group");
  figure.setAttribute("aria-label", "Article image");
  figure.setAttribute("data-media-id", asset.id);
  figure.setAttribute("data-src", asset.src);
  figure.setAttribute("data-alt", asset.alt);
  figure.setAttribute("data-align", "center");
  figure.setAttribute("data-size", "large");
  const image = document.createElement("img");
  image.src = asset.src;
  image.alt = asset.alt;
  image.loading = "lazy";
  figure.appendChild(image);
  if (asset.caption.trim()) {
    const caption = document.createElement("figcaption");
    caption.textContent = asset.caption;
    figure.appendChild(caption);
  }
  return figure;
}

function emptyParagraph(): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.appendChild(document.createElement("br"));
  return paragraph;
}

export type BlogEditorHandle = {
  insertImage: (asset: MediaAsset) => void;
  focus: () => void;
};

type ImageSelection = {
  element: HTMLElement;
  alt: string;
  caption: string;
  align: BlogImageAlign;
  size: BlogImageSize;
};

/**
 * Continuous rich text canvas: paragraphs, headings, lists and inline Media
 * Library images live in one editable document in reading order. Images are
 * atomic figures inside the canvas, so typing continues naturally before and
 * after them, and selecting one opens its alt/caption/alignment/size controls.
 */
export const BlogEditor = forwardRef<
  BlogEditorHandle,
  {
    blocks: BlogContentBlock[];
    onChange: (blocks: BlogContentBlock[]) => void;
    onRequestImage: () => void;
  }
>(function BlogEditor({ blocks, onChange, onRequestImage }, ref) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const lastEmitted = useRef<string>("");
  const [initialHtml] = useState(() => blocksToHtml(blocks));
  const propsSignature = JSON.stringify(blocks);
  const [image, setImage] = useState<ImageSelection | null>(null);

  function emit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parsed = parseBlocks(canvas);
    const next: BlogContentBlock[] = parsed.length
      ? parsed
      : [{ type: "text", text: "", order: 1 }];
    const signature = JSON.stringify(next);
    lastEmitted.current = signature;
    if (signature !== propsSignature) onChange(next);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (propsSignature === lastEmitted.current) return;
    canvas.innerHTML = blocksToHtml(blocks);
    lastEmitted.current = propsSignature;
    setImage(null);
  }, [blocks, propsSignature]);

  useEffect(() => {
    const onSelectionChange = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const range = selectionInside(canvas);
      if (range) savedRange.current = range.cloneRange();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  function captureSelection() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const range = selectionInside(canvas);
    if (range) savedRange.current = range.cloneRange();
  }

  function currentRange(): Range | undefined {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const saved = savedRange.current;
    if (saved && canvas.contains(saved.startContainer)) return saved;
    return selectionInside(canvas);
  }

  function selectFigure(figure: HTMLElement) {
    const align = figure.getAttribute("data-align");
    const size = figure.getAttribute("data-size");
    setImage({
      element: figure,
      alt: figure.getAttribute("data-alt") ?? "",
      caption: figure.querySelector("figcaption")?.textContent ?? "",
      align: isBlogImageAlign(align) ? align : "center",
      size: isBlogImageSize(size) ? size : "full",
    });
  }

  function patchImage(patch: Partial<Pick<ImageSelection, "alt" | "caption" | "align" | "size">>) {
    if (!image) return;
    const figure = image.element;
    if (!canvasRef.current?.contains(figure)) {
      setImage(null);
      return;
    }
    const next = { ...image, ...patch };
    setImage(next);
    figure.setAttribute("data-alt", next.alt);
    image.element.querySelector("img")?.setAttribute("alt", next.alt);
    if (patch.caption !== undefined) {
      let caption = figure.querySelector("figcaption");
      if (next.caption.trim()) {
        if (!caption) {
          caption = document.createElement("figcaption");
          figure.appendChild(caption);
        }
        caption.textContent = next.caption;
      } else if (caption) {
        caption.remove();
      }
    }
    figure.setAttribute("data-align", next.align);
    figure.setAttribute("data-size", next.size);
    figure.className = `blog-figure blog-figure--${next.align} blog-figure--${next.size}`;
    emit();
  }

  function removeImage() {
    if (!image) return;
    image.element.remove();
    setImage(null);
    emit();
  }

  function insertImage(asset: MediaAsset) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const figure = createFigure(asset);
    const range = currentRange();
    const block = range ? topLevelElement(canvas, range.startContainer) : undefined;
    let paragraphAfter: HTMLElement | null = null;

    if (block && block.tagName === "FIGURE") {
      block.after(figure);
    } else if (
      block &&
      (block.tagName === "P" ||
        block.tagName === "DIV" ||
        /^H[1-6]$/.test(block.tagName))
    ) {
      if (
        range &&
        block.contains(range.startContainer) &&
        block.contains(range.endContainer)
      ) {
        const tail = document.createRange();
        tail.setStart(range.endContainer, range.endOffset);
        tail.setEnd(block, block.childNodes.length);
        const contents = tail.extractContents();
        block.after(figure);
        paragraphAfter = document.createElement(
          block.tagName === "DIV" ? "p" : block.tagName.toLowerCase(),
        );
        paragraphAfter.appendChild(contents);
        if (!paragraphAfter.textContent?.trim() && !paragraphAfter.querySelector("br")) {
          paragraphAfter.appendChild(document.createElement("br"));
        }
        figure.after(paragraphAfter);
        if (!block.textContent?.trim() && !block.querySelector("br")) {
          block.appendChild(document.createElement("br"));
        }
      } else {
        block.after(figure);
      }
    } else if (block && (block.tagName === "UL" || block.tagName === "OL")) {
      block.after(figure);
    } else {
      canvas.appendChild(figure);
    }

    if (!figure.nextElementSibling) {
      paragraphAfter = emptyParagraph();
      figure.after(paragraphAfter);
    }
    if (!figure.previousElementSibling) {
      figure.before(emptyParagraph());
    }

    emit();
    selectFigure(figure);
    if (paragraphAfter) {
      const caret = document.createRange();
      caret.selectNodeContents(paragraphAfter);
      caret.collapse(true);
      savedRange.current = caret.cloneRange();
    } else {
      figure.focus();
    }
  }

  useImperativeHandle(ref, () => ({
    insertImage,
    focus: () => canvasRef.current?.focus(),
  }));

  function applyStyle(style: BlogTextStyle) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvas.contains(document.activeElement) && !savedRange.current) canvas.focus();
    const range = currentRange();
    if (!range) {
      canvas.focus();
      return;
    }
    const block = topLevelElement(canvas, range.startContainer);
    const tag = style === "heading2" ? "h2" : style === "heading3" ? "h3" : "p";
    if (!block || block.tagName === "FIGURE") {
      const element = document.createElement(tag);
      element.appendChild(document.createElement("br"));
      canvas.appendChild(element);
      canvas.focus();
      placeCaret(element);
      emit();
      return;
    }
    const list = block.tagName === "UL" || block.tagName === "OL"
      ? block
      : block.closest("ul,ol");
    if (style === "bulleted" || style === "numbered") {
      const listTag = style === "bulleted" ? "ul" : "ol";
      if (list) {
        if (list.tagName !== listTag.toUpperCase()) {
          const replacement = document.createElement(listTag);
          while (list.firstChild) replacement.appendChild(list.firstChild);
          list.replaceWith(replacement);
        }
        emit();
        return;
      }
      const wrapper = document.createElement(listTag);
      const item = document.createElement("li");
      while (block.firstChild) item.appendChild(block.firstChild);
      wrapper.appendChild(item);
      block.replaceWith(wrapper);
      canvas.focus();
      placeCaret(item);
      emit();
      return;
    }
    if (list) {
      const item = (
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement
      )?.closest("li");
      if (item && list.contains(item)) {
        const replacement = document.createElement(tag);
        while (item.firstChild) replacement.appendChild(item.firstChild);
        item.remove();
        if (list.querySelector("li")) list.after(replacement);
        else list.replaceWith(replacement);
        if (!replacement.textContent?.trim()) replacement.appendChild(document.createElement("br"));
        canvas.focus();
        placeCaret(replacement);
      }
      emit();
      return;
    }
    if (block.tagName.toLowerCase() !== tag) {
      const replacement = document.createElement(tag);
      while (block.firstChild) replacement.appendChild(block.firstChild);
      block.replaceWith(replacement);
      if (!replacement.textContent?.trim()) replacement.appendChild(document.createElement("br"));
      canvas.focus();
      placeCaret(replacement);
    } else {
      canvas.focus();
    }
    emit();
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    const figure = target?.closest("figure.blog-figure");
    if (figure && canvasRef.current?.contains(figure)) {
      selectFigure(figure as HTMLElement);
      return;
    }
    setImage(null);
  }

  return (
    <div className="blog-editor">
      <div className="blog-editor-toolbar" role="toolbar" aria-label="Article formatting">
        {TEXT_STYLES.map((option) => (
          <button
            key={option.style}
            type="button"
            className="button secondary"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyStyle(option.style)}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          className="button secondary"
          onMouseDown={(event) => {
            event.preventDefault();
            captureSelection();
          }}
          onClick={onRequestImage}
        >
          Insert image
        </button>
      </div>
      <div
        ref={canvasRef}
        className="blog-content blog-editor-canvas"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Article body"
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: initialHtml }}
        onInput={emit}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Escape") setImage(null);
        }}
      />
      {image && (
        <div className="blog-editor-image-panel">
          <div className="blog-editor-image-panel__heading">
            <strong>Selected image</strong>
            <div className="actions">
              <button type="button" className="button secondary" onClick={() => setImage(null)}>
                Done
              </button>
              <button type="button" className="button danger" onClick={removeImage}>
                Remove image
              </button>
            </div>
          </div>
          <TextField
            id="inline-image-alt"
            label="Alternative text *"
            value={image.alt}
            maxLength={1000}
            onChange={(event) => patchImage({ alt: event.target.value })}
          />
          <TextField
            id="inline-image-caption"
            label="Caption (optional)"
            value={image.caption}
            maxLength={1000}
            onChange={(event) => patchImage({ caption: event.target.value })}
          />
          <Field label="Alignment" id="inline-image-align">
            <div className="blog-editor-choice" role="group" aria-label="Image alignment">
              {ALIGNMENTS.map((option) => (
                <button
                  key={option.align}
                  type="button"
                  className={`button secondary${image.align === option.align ? " is-active" : ""}`}
                  aria-pressed={image.align === option.align}
                  onClick={() => patchImage({ align: option.align })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Display size" id="inline-image-size">
            <div className="blog-editor-choice" role="group" aria-label="Image display size">
              {SIZES.map((option) => (
                <button
                  key={option.size}
                  type="button"
                  className={`button secondary${image.size === option.size ? " is-active" : ""}`}
                  aria-pressed={image.size === option.size}
                  onClick={() => patchImage({ size: option.size })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}
      <small>
        Write directly in the canvas. Insert an image wherever the cursor is, then select it to
        edit its alternative text, caption, alignment and display size.
      </small>
    </div>
  );
});
