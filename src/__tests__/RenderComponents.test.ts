import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { tick } from 'svelte';
import RenderMarkdown from '../lib/components/RenderMarkdown.svelte';
import RenderPdf from '../lib/components/RenderPdf.svelte';
import RenderFile from '../lib/components/RenderFile.svelte';
import { worldStore, focusedEntityStore, focusEntity } from '../lib/stores/world';
import { resizeElement } from './setup';

// Mock Tauri apps API
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (src: string) => src,
}));

// Mock pdfjs-dist variables using vi.hoisted to ensure they are available to vi.mock
const { mockGetPage, mockDestroy, mockPdfDoc, mockRender, pageDims } = vi.hoisted(() => {
  // Mutable so individual tests can describe a landscape or portrait document.
  const pageDims = { width: 600, height: 800 };

  const mockRender = vi.fn().mockReturnValue({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  });

  // Scale-aware viewport: the component derives fit scales from these numbers,
  // so a viewport that ignored `scale` would hide real regressions.
  const mockGetPage = vi.fn().mockImplementation(() =>
    Promise.resolve({
      getViewport: ({ scale = 1 }: { scale?: number } = {}) => ({
        width: pageDims.width * scale,
        height: pageDims.height * scale,
      }),
      render: mockRender,
    })
  );

  const mockDestroy = vi.fn();

  const mockPdfDoc = {
    numPages: 5,
    getPage: mockGetPage,
    destroy: mockDestroy,
  };

  return { mockGetPage, mockDestroy, mockPdfDoc, mockRender, pageDims };
});

vi.mock('pdfjs-dist', () => {
  return {
    GlobalWorkerOptions: {
      workerSrc: '',
    },
    getDocument: vi.fn().mockImplementation((params) => {
      if (!params || typeof params !== 'object' || (!params.url && !params.data && !params.range)) {
        throw new Error('getDocument - expected either `data`, `range`, or `url` parameter.');
      }
      return {
        promise: Promise.resolve(mockPdfDoc),
        destroy: vi.fn(),
      };
    }),
  };
});

// Mock pdfjs worker import query
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => {
  return {
    default: 'mocked-worker-url',
  };
});

describe('RenderMarkdown Component', () => {
  it('renders markdown parsed as safe HTML', () => {
    const markdown = '# Heading 1\nThis is **bold** text.\n[Link](https://google.com)';
    render(RenderMarkdown, { source: markdown });

    const heading = screen.getByRole('heading', { level: 1, name: 'Heading 1' });
    expect(heading).toBeInTheDocument();

    const boldText = screen.getByText('bold');
    expect(boldText.tagName.toLowerCase()).toBe('strong');

    const link = screen.getByRole('link', { name: 'Link' });
    expect(link).toHaveAttribute('href', 'https://google.com');
  });

  it('sanitizes malicious script tags', () => {
    const malicious = 'Malicious<script>alert("XSS")</script> content';
    const { container } = render(RenderMarkdown, { source: malicious });

    expect(screen.getByText(/Malicious/)).toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
  });
});

describe('RenderPdf Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageDims.width = 600;
    pageDims.height = 800;
  });

  it('loads the PDF and renders controls and canvas', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });

    // Initially shows loading state
    expect(screen.getByText('Loading PDF...')).toBeInTheDocument();

    // Wait for pdf Doc promise to resolve and load controls
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    // Check page numbers indicator and zoom indicator
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByText('/ 5')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    // Check mock calls
    expect(mockGetPage).toHaveBeenCalledWith(1);
  });

  it('navigates page-by-page when clicking next/prev buttons', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });

    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    const nextBtn = screen.getByTitle('Next Page');
    const prevBtn = screen.getByTitle('Previous Page');

    // Prev button should be disabled initially on page 1
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).not.toBeDisabled();

    // Click Next
    await fireEvent.click(nextBtn);
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect(mockGetPage).toHaveBeenLastCalledWith(2);
    expect(prevBtn).not.toBeDisabled();

    // Click Prev
    await fireEvent.click(prevBtn);
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(mockGetPage).toHaveBeenLastCalledWith(1);
  });

  it('adjusts zoom level when clicking zoom buttons', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });

    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    const zoomInBtn = screen.getByTitle('Zoom In');
    const zoomOutBtn = screen.getByTitle('Zoom Out');
    const zoomResetBtn = screen.getByTitle('Reset Zoom');

    // Zoom In
    await fireEvent.click(zoomInBtn);
    expect(screen.getByText('125%')).toBeInTheDocument();

    // Zoom Out twice
    await fireEvent.click(zoomOutBtn);
    await fireEvent.click(zoomOutBtn);
    expect(screen.getByText('75%')).toBeInTheDocument();

    // Reset Zoom
    expect(zoomResetBtn).not.toBeDisabled();
    await fireEvent.click(zoomResetBtn);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(zoomResetBtn).toBeDisabled();
  });
  it('paints the first page exactly once instead of rendering at 1.0 and again at fit', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });

    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });
    await waitFor(() => expect(mockRender).toHaveBeenCalled());

    // Let any further effect flush settle before asserting there was no second pass.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it('zooms further out than the old 50% floor', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    const zoomOutBtn = screen.getByTitle('Zoom Out');
    for (let i = 0; i < 3; i++) await fireEvent.click(zoomOutBtn);

    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(zoomOutBtn).toBeDisabled();
  });

  it('zooms further in than the old 300% ceiling', async () => {
    render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    const zoomInBtn = screen.getByTitle('Zoom In');
    for (let i = 0; i < 9; i++) await fireEvent.click(zoomInBtn);

    expect(screen.getByText('325%')).toBeInTheDocument();
    expect(zoomInBtn).not.toBeDisabled();
  });

  it('shows every control when the container has room for them', async () => {
    const { container } = render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    resizeElement(container.querySelector('.pdf-viewer-container')!, 600, 800);
    await tick();

    for (const title of ['Zoom In', 'Zoom Out', 'Reset Zoom', 'Previous Page', 'Next Page']) {
      expect(screen.getByTitle(title)).toBeInTheDocument();
    }
    // Fit mode is togglable, so only one of the two labels is present at a time.
    expect(screen.getByTitle(/^Fit (Width|Page)$/)).toBeInTheDocument();
  });

  it('drops controls it has no room for, least essential first', async () => {
    const { container } = render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });
    const viewer = container.querySelector('.pdf-viewer-container')!;

    // Narrow: reset and fit-mode go, the rest stays.
    resizeElement(viewer, 220, 400);
    await tick();
    expect(screen.queryByTitle('Reset Zoom')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/^Fit (Width|Page)$/)).not.toBeInTheDocument();
    expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
    expect(screen.getByTitle('Next Page')).toBeInTheDocument();

    // Narrower: the whole zoom section goes, page navigation survives longest.
    resizeElement(viewer, 150, 400);
    await tick();
    expect(screen.queryByTitle('Zoom In')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Zoom Out')).not.toBeInTheDocument();
    expect(screen.getByTitle('Next Page')).toBeInTheDocument();
    expect(screen.getByTitle('Previous Page')).toBeInTheDocument();

    // Too small for any of it: the toolbar leaves entirely.
    resizeElement(viewer, 90, 400);
    await tick();
    expect(screen.queryByTestId('pdf-toolbar')).not.toBeInTheDocument();

    // Short cells lose it too — a toolbar taller than the page it serves is
    // not a toolbar worth having.
    resizeElement(viewer, 600, 90);
    await tick();
    expect(screen.queryByTestId('pdf-toolbar')).not.toBeInTheDocument();
  });

  it('does not strand a zoom the user can no longer undo', async () => {
    const { container } = render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });
    const viewer = container.querySelector('.pdf-viewer-container')!;

    resizeElement(viewer, 600, 800);
    await tick();
    await fireEvent.click(screen.getByTitle('Zoom In'));
    expect(screen.getByText('125%')).toBeInTheDocument();

    // The zoom controls disappear; the zoom they set must not stay behind.
    resizeElement(viewer, 150, 400);
    await tick();
    resizeElement(viewer, 600, 800);
    await tick();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('reports the first page size so the host can match the document shape', async () => {
    pageDims.width = 900;
    pageDims.height = 500;
    const onFirstPageSize = vi.fn();

    render(RenderPdf, { mediaSrc: 'wide.pdf', onFirstPageSize });

    await waitFor(() => {
      expect(onFirstPageSize).toHaveBeenCalledWith({ width: 900, height: 500 });
    });
    expect(onFirstPageSize).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a PDF object lacks a destroy method during teardown', async () => {
    const { unmount } = render(RenderPdf, { mediaSrc: 'my_doc.pdf', displayName: 'my_doc.pdf' });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    delete (mockPdfDoc as any).destroy;
    expect(() => unmount()).not.toThrow();
    (mockPdfDoc as any).destroy = mockDestroy;
  });

});

describe('Integration inside RenderFile.svelte', () => {
  it('renders RenderMarkdown when file is a .md file', async () => {
    // Populate store
    worldStore.loadFromData({
      entities: [
        {
          id: 1,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: 'notes.md', scale: 1, position: { x: 0, y: 0 } }
            }
          ]
        }
      ]
    });

    // Mock fetch for markdown content
    const mockMarkdown = '# Svelte 5 Note\nInteractive layout';
    const mockResponse = {
      ok: true,
      text: () => Promise.resolve(mockMarkdown)
    };
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse as Response);

    render(RenderFile, { entityId: 1, targetPath: 'notes.md', scale: 1, position: { x: 0, y: 0 } });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Svelte 5 Note' })).toBeInTheDocument();
    });
    expect(screen.getByText('Interactive layout')).toBeInTheDocument();
  });

  it('renders RenderPdf when file is a .pdf file', async () => {
    // Populate store
    worldStore.loadFromData({
      entities: [
        {
          id: 2,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: 'document.pdf', scale: 1, position: { x: 0, y: 0 } }
            }
          ]
        }
      ]
    });

    render(RenderFile, { entityId: 2, targetPath: 'document.pdf', scale: 1, position: { x: 0, y: 0 } });

    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    // Page count indicator verify
    expect(screen.getByText('/ 5')).toBeInTheDocument();
  });

  it('does not navigate when a control inside the card is clicked', async () => {
    worldStore.loadFromData({
      entities: [
        {
          id: 7,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: '/trove/document.pdf', scale: 1, position: { x: 0, y: 0 } },
            },
          ],
        },
      ],
    });
    focusEntity(null);

    render(RenderFile, { entityId: 7, targetPath: '/trove/document.pdf', scale: 1, position: { x: 0, y: 0 } });
    await waitFor(() => {
      expect(screen.queryByText('Loading PDF...')).not.toBeInTheDocument();
    });

    // Paging the document is not a request to open the card.
    await fireEvent.click(screen.getByTitle('Next Page'));

    let focused: number | null = -1;
    focusedEntityStore.subscribe((value) => {
      focused = value;
    })();
    expect(focused).toBeNull();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
  });

  it('navigates when the card itself is clicked', async () => {
    worldStore.loadFromData({
      entities: [
        {
          id: 8,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: '/trove/photo.png', scale: 1, position: { x: 0, y: 0 } },
            },
          ],
        },
      ],
    });
    focusEntity(null);

    const { container } = render(RenderFile, {
      entityId: 8,
      targetPath: '/trove/photo.png',
      scale: 1,
      position: { x: 0, y: 0 },
    });

    await fireEvent.click(container.querySelector('.render-file') as HTMLElement);

    let focused: number | null = null;
    focusedEntityStore.subscribe((value) => {
      focused = value;
    })();
    expect(focused).toBe(8);
  });

  it('names the card after the entity, not after its whole path', () => {
    worldStore.loadFromData({
      entities: [
        {
          id: 9,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: '/trove/holiday/photo.png', scale: 1, position: { x: 0, y: 0 } },
            },
          ],
        },
        {
          id: 10,
          parentId: 9,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: '/trove/holiday/photo.png/note.txt', scale: 1, position: { x: 0, y: 0 } },
            },
          ],
        },
      ],
    });

    const { container } = render(RenderFile, {
      entityId: 9,
      targetPath: '/trove/holiday/photo.png',
      scale: 1,
      position: { x: 0, y: 0 },
    });

    const caption = container.querySelector('.caption-name') as HTMLElement;
    expect(caption).toHaveTextContent('photo.png');
    expect(caption).not.toHaveTextContent('/trove/');
    // Any entity can hold other entities, so a card says what it is holding.
    expect(container.querySelector('.caption-count')).toHaveTextContent('1');
  });

  it('gives a landscape PDF card the aspect ratio of its first page', async () => {
    pageDims.width = 1000;
    pageDims.height = 500;

    worldStore.loadFromData({
      entities: [
        {
          id: 3,
          components: [
            {
              componentType: 'renderFile',
              settings: { targetPath: 'slides.pdf', scale: 1, position: { x: 0, y: 0 } },
            },
          ],
        },
      ],
    });

    const { container } = render(RenderFile, {
      entityId: 3,
      targetPath: 'slides.pdf',
      scale: 1,
      position: { x: 0, y: 0 },
    });

    const card = container.querySelector('.render-file') as HTMLElement;
    // Before the page is measured a PDF falls back to the portrait default.
    expect(card).toHaveClass('portrait');

    await waitFor(() => {
      expect(card.getAttribute('style') ?? '').toContain('--card-aspect: 1000 / 500');
    });
    expect(card).toHaveClass('landscape');
    expect(card).not.toHaveClass('portrait');

    pageDims.width = 600;
    pageDims.height = 800;
  });
});
