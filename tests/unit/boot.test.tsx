import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectPage } from '@/features/connect/ConnectPage';

describe('boot connection experience', () => {
  it('renders Project ID and key entry and advertises read-only boot', () => {
    render(<MemoryRouter><ConnectPage /></MemoryRouter>);
    expect(screen.getByText(/Read-only on every boot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Project ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Credential value/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save workspace and test schema access/i })).toBeInTheDocument();
  });
});
