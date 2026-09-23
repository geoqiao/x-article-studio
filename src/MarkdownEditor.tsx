import { useLayoutEffect, useRef, type RefObject, type TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  highlightedLine?: number;
};

/** Measure wrapped logical lines so the gutter follows the textarea exactly. */
export function MarkdownEditor({ inputRef, highlightedLine, value, ...props }: Props) {
  const gutter = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const lines = value.split('\n');
  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = measure.current;
    const numbers = gutter.current;
    if (!input || !mirror || !numbers) return;
    const update = () => {
      const style = getComputedStyle(input);
      mirror.style.width = `${input.clientWidth}px`;
      mirror.style.padding = style.padding;
      mirror.style.font = style.font;
      mirror.style.letterSpacing = style.letterSpacing;
      numbers.style.paddingTop = style.paddingTop;
      numbers.style.paddingBottom = style.paddingBottom;
      const measured = Array.from(mirror.children) as HTMLElement[];
      const labels = Array.from(numbers.children) as HTMLElement[];
      measured.forEach((line, index) => { labels[index].style.height = `${line.getBoundingClientRect().height}px`; });
      numbers.scrollTop = input.scrollTop;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(input);
    let active = true;
    void document.fonts.ready.then(() => { if (active) update(); });
    return () => { active = false; observer.disconnect(); };
  }, [inputRef, value]);

  useLayoutEffect(() => {
    if (!highlightedLine || !inputRef.current || !gutter.current) return;
    const label = gutter.current.children[highlightedLine - 1] as HTMLElement | undefined;
    if (label) inputRef.current.scrollTop = Math.max(0, label.offsetTop - inputRef.current.clientHeight / 3);
    gutter.current.scrollTop = inputRef.current.scrollTop;
  }, [highlightedLine, inputRef]);

  return <div className="markdown-editor">
    <div className="line-gutter" aria-hidden="true" ref={gutter}>
      {lines.map((_, i) => <span key={i} data-line={i + 1} className={highlightedLine === i + 1 ? 'highlighted-line' : ''}>{i + 1}</span>)}
    </div>
    <textarea {...props} value={value} ref={inputRef} onScroll={event => {
      if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
      props.onScroll?.(event);
    }} />
    <div ref={measure} className="line-measure" aria-hidden="true">
      {lines.map((line, i) => <div key={i}>{line || '\u200b'}</div>)}
    </div>
  </div>;
}
