import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname, basename, extname } from 'node:path';
import type { GeminiProvider } from '../providers/gemini.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('pdf-tool');

let geminiProvider: GeminiProvider | null = null;

export function setPdfGeminiProvider(provider: GeminiProvider): void {
  geminiProvider = provider;
}

function safePath(workspace: string, filePath: string): string {
  const resolved = resolve(workspace, filePath);
  const rel = relative(workspace, resolved);
  if (rel.startsWith('..') || resolve(resolved) !== resolved.replace(/\/$/, '')) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

const DEFAULT_CSS = `
  @page {
    size: letter;
    margin: 0.75in 1in;
    @bottom-center {
      content: counter(page);
      font-size: 10px;
      color: #999;
    }
  }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #333;
    max-width: 100%;
  }
  .header {
    text-align: center;
    border-bottom: 3px solid #2c5f7c;
    padding-bottom: 12px;
    margin-bottom: 24px;
  }
  .header h1 {
    color: #2c5f7c;
    margin: 0;
    font-size: 22pt;
  }
  .header .subtitle {
    color: #666;
    font-size: 11pt;
    margin-top: 4px;
  }
  h1, h2, h3, h4 {
    color: #2c5f7c;
    margin-top: 1.2em;
  }
  h1 { font-size: 18pt; border-bottom: 2px solid #2c5f7c; padding-bottom: 4px; }
  h2 { font-size: 15pt; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
  h3 { font-size: 13pt; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1em 0;
  }
  th {
    background: #2c5f7c;
    color: white;
    padding: 8px 12px;
    text-align: left;
    font-weight: 600;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #ddd;
  }
  tr:nth-child(even) td {
    background: #f8f9fa;
  }
  code {
    background: #f0f0f0;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre {
    background: #f5f5f5;
    border: 1px solid #ddd;
    border-radius: 4px;
    padding: 12px;
    overflow-x: auto;
  }
  pre code {
    background: none;
    padding: 0;
  }
  blockquote {
    border-left: 4px solid #2c5f7c;
    margin: 1em 0;
    padding: 8px 16px;
    background: #f0f6f9;
    color: #555;
  }
  ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  img { max-width: 100%; height: auto; margin: 1em 0; }
  .footer {
    text-align: center;
    font-size: 9pt;
    color: #999;
    border-top: 1px solid #ddd;
    padding-top: 8px;
    margin-top: 32px;
  }
`;

async function processImagePlaceholders(markdown: string): Promise<string> {
  if (!geminiProvider || !geminiProvider.isReady()) {
    return markdown;
  }

  const imagePattern = /!\[([^\]]*)\]\(IMAGE:([^)]+)\)/g;
  const matches = [...markdown.matchAll(imagePattern)];

  if (matches.length === 0) return markdown;

  let result = markdown;
  for (const match of matches) {
    const [fullMatch, alt, prompt] = match;
    log.info('Generating image for PDF', { prompt: prompt.slice(0, 80) });

    try {
      const imgResult = await geminiProvider.generateImage(prompt.trim());
      if (imgResult) {
        const b64 = imgResult.buffer.toString('base64');
        const dataUri = `data:${imgResult.mimeType};base64,${b64}`;
        result = result.replace(fullMatch, `![${alt}](${dataUri})`);
      } else {
        result = result.replace(fullMatch, `*[Image could not be generated: ${prompt.trim()}]*`);
      }
    } catch (err) {
      log.warn('Image generation failed for PDF placeholder', { prompt, error: String(err) });
      result = result.replace(fullMatch, `*[Image generation failed: ${prompt.trim()}]*`);
    }
  }

  return result;
}

function buildHtml(
  htmlBody: string,
  css: string,
  options: { practiceName?: string; practiceSubtitle?: string; footer?: string },
): string {
  const header = options.practiceName
    ? `<div class="header">
        <h1>${escapeHtml(options.practiceName)}</h1>
        ${options.practiceSubtitle ? `<div class="subtitle">${escapeHtml(options.practiceSubtitle)}</div>` : ''}
      </div>`
    : '';

  const footerHtml = options.footer
    ? `<div class="footer">${escapeHtml(options.footer)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>${css}</style>
</head><body>
${header}
${htmlBody}
${footerHtml}
</body></html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const markdownToPdfTool: Tool = {
  name: 'markdown_to_pdf',
  description:
    'Convert a markdown file to a professionally styled PDF. Supports tables, code blocks, images, and custom branding. Use IMAGE: placeholders in markdown (e.g., ![desc](IMAGE:prompt)) to auto-generate images with AI.',
  inputSchema: {
    type: 'object',
    properties: {
      markdownPath: {
        type: 'string',
        description: 'Path to the markdown file (relative to workspace)',
      },
      outputPath: {
        type: 'string',
        description: 'Output PDF path (relative to workspace). Defaults to same name with .pdf extension.',
      },
      practiceName: {
        type: 'string',
        description: 'Practice/organization name for the header (e.g., "River Crossing Family Dental")',
      },
      practiceSubtitle: {
        type: 'string',
        description: 'Subtitle under the practice name (e.g., "Staff Training Guide")',
      },
      footer: {
        type: 'string',
        description: 'Footer text for the document',
      },
      generateImages: {
        type: 'boolean',
        description: 'Whether to process IMAGE: placeholders and generate images via AI (default: false)',
      },
      cssPath: {
        type: 'string',
        description: 'Path to a custom CSS file to override default styling (relative to workspace)',
      },
    },
    required: ['markdownPath'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const markdownPath = safePath(ctx.workspace, String(input.markdownPath));

    if (!existsSync(markdownPath)) {
      return { content: `File not found: ${input.markdownPath}`, isError: true };
    }

    // Determine output path
    const outName = input.outputPath
      ? String(input.outputPath)
      : basename(markdownPath, extname(markdownPath)) + '.pdf';
    const outputPath = safePath(ctx.workspace, outName);

    log.info('Converting markdown to PDF', {
      input: String(input.markdownPath),
      output: outName,
    });

    try {
      // Read markdown
      let markdown = readFileSync(markdownPath, 'utf-8');

      // Process image placeholders if enabled
      if (input.generateImages) {
        markdown = await processImagePlaceholders(markdown);
      }

      // Load CSS (custom or default)
      let css = DEFAULT_CSS;
      if (input.cssPath) {
        const cssFile = safePath(ctx.workspace, String(input.cssPath));
        if (existsSync(cssFile)) {
          css = readFileSync(cssFile, 'utf-8');
        } else {
          return { content: `CSS file not found: ${input.cssPath}`, isError: true };
        }
      }

      // Convert markdown to HTML (lazy import)
      const { marked } = await import('marked');
      const htmlBody = await marked(markdown);

      // Build full HTML document
      const fullHtml = buildHtml(htmlBody, css, {
        practiceName: input.practiceName as string | undefined,
        practiceSubtitle: input.practiceSubtitle as string | undefined,
        footer: input.footer as string | undefined,
      });

      // Launch Puppeteer and generate PDF (lazy import)
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const page = await browser.newPage();
      await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

      const pdfBuffer = Buffer.from(
        await page.pdf({
          format: 'Letter',
          printBackground: true,
          margin: { top: '0.75in', right: '1in', bottom: '0.75in', left: '1in' },
        }),
      );

      await browser.close();

      // Ensure output directory exists and write PDF
      const outDir = dirname(outputPath);
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      writeFileSync(outputPath, pdfBuffer);

      const relOut = relative(ctx.workspace, outputPath);
      log.info('PDF generated', { path: relOut, size: pdfBuffer.length });

      return {
        content: `PDF generated: ${relOut} (${(pdfBuffer.length / 1024).toFixed(1)} KB)`,
        document: {
          buffer: pdfBuffer,
          mimeType: 'application/pdf',
          fileName: basename(outputPath),
          caption: input.practiceName
            ? `${input.practiceName} — ${basename(outputPath)}`
            : basename(outputPath),
        },
      };
    } catch (err) {
      log.error('PDF generation failed', { error: String(err) });
      return { content: `PDF generation failed: ${String(err)}`, isError: true };
    }
  },
};
