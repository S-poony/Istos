import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import RenderMarkdown from '../lib/components/RenderMarkdown.svelte';
import RenderPdf from '../lib/components/RenderPdf.svelte';
import RenderFile from '../lib/components/RenderFile.svelte';
import { worldStore } from '../lib/stores/world';

// Mock Tauri apps API
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (src: string) => src,
}));

// Mock pdfjs-dist variables using vi.hoisted to ensure they are available to vi.mock
const { mockGetPage, mockDestroy, mockPdfDoc } = vi.hoisted(() => {
  const mockGetPage = vi.fn().mockResolvedValue({
    getViewport: vi.fn().mockReturnValue({ width: 600, height: 800 }),
    render: vi.fn().mockReturnValue({
      promise: Promise.resolve(),
      cancel: vi.fn(),
    }),
  });

  const mockDestroy = vi.fn();

  const mockPdfDoc = {
    numPages: 5,
    getPage: mockGetPage,
    destroy: mockDestroy,
  };

  return { mockGetPage, mockDestroy, mockPdfDoc };
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
});
