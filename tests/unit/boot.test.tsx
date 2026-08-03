import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConnectPage } from '@/features/connect/ConnectPage';

describe('boot connection experience', () => {
  it('renders key entry and enables the optional schema test only after a capable key is entered', () => {
    render(
      <MemoryRouter>
        <ConnectPage />
      </MemoryRouter>
    );

    expect(screen.getByText(/Read-only on every boot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Project ID/i)).toBeInTheDocument();

    const credentialInput = screen.getByLabelText(/Credential value/i);
    const schemaTestToggle = screen.getByRole('checkbox', {
      name: /Test read-only schema access after saving/i
    });
    const autoDashboardToggle = screen.getByRole('checkbox', {
      name: /Create dashboards automatically for every stream/i
    });

    expect(credentialInput).toBeInTheDocument();
    expect(schemaTestToggle).toBeDisabled();
    expect(autoDashboardToggle).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Save workspace without test/i })
    ).toBeInTheDocument();

    fireEvent.change(credentialInput, {
      target: { value: 'synthetic-read-key' }
    });

    expect(schemaTestToggle).toBeEnabled();
    expect(autoDashboardToggle).toBeEnabled();
    expect(autoDashboardToggle).toBeChecked();
    expect(
      screen.getByRole('button', {
        name: /Save workspace and test schema access/i
      })
    ).toBeInTheDocument();
  });
});
