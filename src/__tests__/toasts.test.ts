import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom';
import { toasts, pushToast, dismissToast, clearToasts } from '../lib/stores/toasts';
import ToastStack from '../lib/components/ToastStack.svelte';

describe('toast store', () => {
  beforeEach(() => {
    clearToasts();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearToasts();
  });

  it('auto-dismisses success toasts', () => {
    pushToast('success', 'Opened "Photos"');
    expect(get(toasts)).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(get(toasts)).toHaveLength(0);
  });

  it('keeps error toasts until they are dismissed', () => {
    const id = pushToast('error', 'Could not open the trove', 'Access denied');

    vi.advanceTimersByTime(60_000);
    expect(get(toasts)).toHaveLength(1);

    dismissToast(id);
    expect(get(toasts)).toHaveLength(0);
  });

  it('keeps each toast distinguishable by kind', () => {
    pushToast('success', 'ok');
    pushToast('error', 'nope');
    pushToast('info', 'fyi');

    expect(get(toasts).map((t) => t.kind)).toEqual(['success', 'error', 'info']);
  });
});

describe('ToastStack', () => {
  beforeEach(() => clearToasts());
  afterEach(() => clearToasts());

  it('marks a failure as an assertive alert, not a passive status', () => {
    pushToast('error', 'Could not open the trove', 'Access denied');
    render(ToastStack);

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('data-kind', 'error');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('renders a cancellation as info rather than success', () => {
    pushToast('info', 'No folder selected');
    render(ToastStack);

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('data-kind', 'info');
    expect(toast).toHaveAttribute('role', 'status');
  });

  it('renders every severity through the same shell class', () => {
    pushToast('success', 'ok');
    pushToast('error', 'nope');
    render(ToastStack);

    for (const toast of screen.getAllByTestId('toast')) {
      expect(toast).toHaveClass('toast');
    }
  });
});
