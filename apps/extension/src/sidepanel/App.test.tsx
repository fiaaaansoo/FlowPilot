import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Command, CommandResponse, Workflow } from '@flowpilot/shared';
import { App } from './App';
import { EMPTY_SNAPSHOT, type ExtensionApi, type PanelSnapshot } from './api';

const workflow: Workflow = {
  schemaVersion: 2,
  id: 'wf-1',
  name: 'Procédure sur localhost:5173',
  origin: 'http://localhost:5173',
  createdAt: '2026-11-21T10:00:00.000Z',
  steps: [{ id: 's', kind: 'navigate', url: 'http://localhost:5173/' }],
};

function fakeApi(initial: Partial<PanelSnapshot> = {}, reply?: (command: Command) => CommandResponse) {
  let snapshot: PanelSnapshot = { ...EMPTY_SNAPSHOT, ...initial };
  const listeners = new Set<() => void>();
  const send = vi.fn((command: Command) =>
    Promise.resolve<CommandResponse>(reply?.(command) ?? { ok: true, value: snapshot.session }),
  );
  const requestOrigin = vi.fn(() => Promise.resolve(true));
  const api: ExtensionApi = {
    snapshot: () => Promise.resolve(snapshot),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send,
    requestOrigin,
    removeOrigin: () => Promise.resolve(true),
  };
  const set = (next: Partial<PanelSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((fn) => {
      fn();
    });
  };
  return { api, send, requestOrigin, set };
}

const button = (name: string) => screen.getByRole('button', { name });

describe('Side Panel', () => {
  it('au repos sans workflow : seul Enregistrer est actif', async () => {
    render(<App api={fakeApi().api} />);
    await waitFor(() => expect(button('Enregistrer')).toBeEnabled());
    expect(button('Arrêter')).toBeDisabled();
    expect(button('Rejouer')).toBeDisabled();
    expect(screen.getByText('Au repos')).toBeInTheDocument();
  });

  it('envoie record/start au service worker', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await waitFor(() => expect(button('Enregistrer')).toBeEnabled());
    await userEvent.click(button('Enregistrer'));
    expect(fake.send).toHaveBeenCalledWith({ type: 'record/start' });
  });

  it('pendant un enregistrement : seul Arrêter est actif, l’état est annoncé', async () => {
    const fake = fakeApi({
      session: { status: 'recording', tabId: 1, origin: 'http://localhost:5173', workflowId: 'w', startedAt: Date.now() },
      workflows: { workflows: [workflow], invalidCount: 0 },
    });
    render(<App api={fake.api} />);
    await waitFor(() => expect(button('Arrêter')).toBeEnabled());
    expect(button('Enregistrer')).toBeDisabled();
    expect(button('Rejouer')).toBeDisabled();
    expect(screen.getByLabelText('État de FlowPilot')).toHaveAttribute('data-status', 'recording');
    await userEvent.click(button('Arrêter'));
    expect(fake.send).toHaveBeenCalledWith({ type: 'session/stop' });
  });

  it('Rejouer lance le workflow sélectionné', async () => {
    const fake = fakeApi({ workflows: { workflows: [workflow], invalidCount: 0 } });
    render(<App api={fake.api} />);
    await waitFor(() => expect(button('Rejouer')).toBeEnabled());
    await userEvent.click(button('Rejouer'));
    expect(fake.send).toHaveBeenCalledWith({ type: 'replay/start', workflowId: 'wf-1' });
  });

  it('affiche l’erreur renvoyée par le service worker', async () => {
    const fake = fakeApi({}, () => ({
      ok: false,
      error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Autorisez http://localhost:5173 dans « Sites autorisés » avant d’enregistrer.' },
    }));
    render(<App api={fake.api} />);
    await waitFor(() => expect(button('Enregistrer')).toBeEnabled());
    await userEvent.click(button('Enregistrer'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Autorisez http://localhost:5173');
  });

  it('demande l’accès à un domaine saisi, puis l’affiche', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await userEvent.type(screen.getByLabelText('Autoriser un site'), 'localhost:5173');
    await userEvent.click(button('Autoriser'));
    expect(fake.requestOrigin).toHaveBeenCalledWith('http://localhost/*');
    fake.set({ allowedOrigins: ['http://localhost/*'] });
    expect(await screen.findByText('http://localhost')).toBeInTheDocument();
  });

  it('refuse une saisie de domaine invalide sans appeler Chrome', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await userEvent.type(screen.getByLabelText('Autoriser un site'), 'chrome://settings');
    await userEvent.click(button('Autoriser'));
    expect(fake.requestOrigin).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Autoriser un site')).toHaveAttribute('aria-invalid', 'true');
  });

  it('signale une demande de permission rejetée par Chrome et garde la saisie', async () => {
    const fake = fakeApi();
    fake.requestOrigin.mockImplementationOnce(() => Promise.reject(new Error('Only permissions specified in the manifest may be requested.')));
    render(<App api={fake.api} />);
    const input = screen.getByLabelText('Autoriser un site');
    await userEvent.type(input, 'exemple.fr');
    await userEvent.click(button('Autoriser'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Accès à https://exemple.fr non accordé.');
    expect(input).toHaveValue('exemple.fr');
  });

  it('refuse un site en http clair hors localhost sans appeler Chrome', async () => {
    const fake = fakeApi();
    render(<App api={fake.api} />);
    await userEvent.type(screen.getByLabelText('Autoriser un site'), 'http://intranet');
    await userEvent.click(button('Autoriser'));
    expect(fake.requestOrigin).not.toHaveBeenCalled();
  });

  it('propose de réessayer si l’état ne peut pas être lu', async () => {
    const fake = fakeApi();
    const api: ExtensionApi = { ...fake.api, snapshot: () => Promise.reject(new Error('storage indisponible')) };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<App api={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de lire l’état de l’extension');
    expect(button('Réessayer')).toBeInTheDocument();
  });

  it('affiche les étapes du workflow sélectionné et l’étape en échec du dernier run', async () => {
    const fake = fakeApi({
      workflows: { workflows: [workflow], invalidCount: 0 },
      runs: [
        {
          workflowId: 'wf-1',
          outcome: 'failed',
          startedAt: 1,
          finishedAt: 2,
          stepsCompleted: 0,
          totalSteps: 1,
          failure: { stepIndex: 0, code: 'NAVIGATION_FAILED', message: 'La page n’a pas fini de charger en 15 s.' },
          log: [{ stepIndex: 0, kind: 'navigate', status: 'failed', startedAt: 1, finishedAt: 2, code: 'NAVIGATION_FAILED', message: 'La page n’a pas fini de charger en 15 s.' }],
        },
      ],
    });
    render(<App api={fake.api} />);
    expect(await screen.findByText(/Échec à l’étape 1 : La page n’a pas fini de charger/)).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Étapes de Procédure sur localhost:5173' });
    expect(steps).toHaveTextContent('Ouvrir /');
    expect(steps).toHaveTextContent('en échec');
  });

  it('montre les étapes capturées en direct pendant un enregistrement', async () => {
    const fake = fakeApi({
      session: { status: 'recording', tabId: 1, origin: 'http://localhost:5173', workflowId: 'w', startedAt: Date.now() },
      draft: {
        workflowId: 'w',
        origin: 'http://localhost:5173',
        startUrl: 'http://localhost:5173/',
        startedAt: 0,
        events: [{ kind: 'click', at: 1, target: { tag: 'button', name: 'Rechercher', attributes: {}, css: 'button' } }],
      },
    });
    render(<App api={fake.api} />);
    const live = await screen.findByRole('list', { name: 'Étapes capturées' });
    expect(live).toHaveTextContent('Cliquer sur « Rechercher »');
    expect(screen.getByLabelText('État de FlowPilot')).toHaveTextContent('2 étapes');
  });

  it('demande confirmation avant une action irréversible et transmet la décision', async () => {
    const confirmFlow = {
      ...workflow,
      steps: [
        workflow.steps[0] as Workflow['steps'][number],
        { id: 's2', kind: 'click' as const, confirm: true as const, target: { tag: 'button', name: 'Envoyer la candidature', attributes: {}, css: 'button' } },
      ],
    };
    const fake = fakeApi({
      session: { status: 'replaying', tabId: 1, workflowId: 'wf-1', startedAt: 1, stepIndex: 1, awaitingHuman: true },
      workflows: { workflows: [confirmFlow], invalidCount: 0 },
    });
    render(<App api={fake.api} />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirmation requise' });
    expect(dialog).toHaveTextContent('Cliquer sur « Envoyer la candidature »');
    await userEvent.click(button('Confirmer et exécuter'));
    expect(fake.send).toHaveBeenCalledWith({ type: 'replay/continue', stepIndex: 1 });
  });

  it('garde le service worker éveillé pendant un replay', async () => {
    const fake = fakeApi({ session: { status: 'replaying', tabId: 1, workflowId: 'wf-1', startedAt: 1, stepIndex: 0 } });
    render(<App api={fake.api} keepAliveMs={20} />);
    await waitFor(() => expect(fake.send).toHaveBeenCalledWith({ type: 'session/get' }));
  });
});
