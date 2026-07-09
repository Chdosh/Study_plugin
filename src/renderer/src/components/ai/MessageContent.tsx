import { useEffect, useMemo, useState } from 'react';

export function MessageContent({ content, animated }: { content: string; animated?: boolean }): JSX.Element {
  const renderedText = useTypewriterText(content, Boolean(animated));
  const blocks = useMemo(() => toMessageBlocks(renderedText), [renderedText]);

  return (
    <div className="message-content">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          return <strong className="message-heading" key={`${block.kind}-${index}`}>{block.text}</strong>;
        }
        if (block.kind === 'code') {
          return <pre key={`${block.kind}-${index}`}><code>{block.text}</code></pre>;
        }
        if (block.kind === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`${block.kind}-${index}`}>
            {block.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
            </ListTag>
          );
        }
        return <p key={`${block.kind}-${index}`}>{block.text}</p>;
      })}
      {animated && renderedText.length < content.length && <span className="type-cursor" aria-hidden="true" />}
    </div>
  );
}

function useTypewriterText(text: string, enabled: boolean): string {
  const [visibleText, setVisibleText] = useState(enabled ? '' : text);

  useEffect(() => {
    if (!enabled) {
      setVisibleText(text);
      return;
    }

    setVisibleText('');
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisibleText(text.slice(0, index));
      if (index >= text.length) {
        window.clearInterval(timer);
      }
    }, 16);

    return () => window.clearInterval(timer);
  }, [text, enabled]);

  return visibleText;
}

type MessageBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string };

function toMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let codeLines: string[] = [];
  let inCodeBlock = false;

  function flushParagraph(): void {
    const text = paragraph.join('\n').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  }

  function flushList(): void {
    if (listItems.length > 0) blocks.push({ kind: 'list', ordered: listOrdered, items: listItems });
    listItems = [];
    listOrdered = false;
  }

  function flushCode(): void {
    if (codeLines.length > 0) blocks.push({ kind: 'code', text: codeLines.join('\n').trimEnd() });
    codeLines = [];
  }

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();

    if (/^```/u.test(line.trim())) {
      if (inCodeBlock) {
        flushCode();
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', text: cleanMarkdownText(heading[1]) });
      continue;
    }

    const bullet = trimmed.match(/^([-*•]|\d+[.)、])\s*(.+)$/u);
    if (bullet) {
      flushParagraph();
      const ordered = /^\d/u.test(bullet[1]);
      if (listItems.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(cleanMarkdownText(bullet[2]));
      continue;
    }

    flushList();
    paragraph.push(cleanMarkdownText(trimmed));
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks.length > 0 ? blocks : [{ kind: 'paragraph', text: content }];
}

function cleanMarkdownText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .trim();
}



