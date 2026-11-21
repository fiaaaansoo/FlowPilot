import { useState, type SubmitEvent } from 'react';
import { patternFromUserInput, patternLabel as displayPattern } from '@flowpilot/shared';

interface Props {
  origins: string[];
  /** Résout `true` si Chrome a accordé l'accès. */
  onAllow: (pattern: string) => Promise<boolean>;
  onRevoke: (pattern: string) => Promise<void>;
}

/**
 * FlowPilot n'a accès à aucun site par défaut. L'utilisateur accorde l'accès
 * domaine par domaine ; Chrome affiche sa propre demande de confirmation.
 */
export function AllowedSites({ origins, onAllow, onRevoke }: Props) {
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pattern = patternFromUserInput(value);
    if (pattern === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // Appel synchrone dans le gestionnaire : `permissions.request` exige le geste utilisateur.
    void onAllow(pattern).then((granted) => {
      if (granted) setValue('');
    });
  };

  return (
    <section className="panel-section" aria-labelledby="sites-title">
      <h2 id="sites-title">Sites autorisés</h2>
      {origins.length === 0 ? (
        <p className="empty">FlowPilot n’a accès à aucun site. Autorisez celui où vous voulez enregistrer.</p>
      ) : (
        <ul className="sites">
          {origins.map((pattern) => (
            <li key={pattern} className="site">
              <span className="site__name">{displayPattern(pattern)}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => void onRevoke(pattern)}
                aria-label={`Retirer l’accès à ${displayPattern(pattern)}`}
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="site-form" onSubmit={submit} noValidate>
        <label htmlFor="site-input">Autoriser un site</label>
        <div className="site-form__row">
          <input
            id="site-input"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="localhost:5173"
            value={value}
            aria-invalid={invalid}
            aria-describedby="site-hint"
            onChange={(event) => {
              setValue(event.target.value);
              setInvalid(false);
            }}
          />
          <button type="submit" className="secondary-button">
            Autoriser
          </button>
        </div>
        <p id="site-hint" className={invalid ? 'hint hint--error' : 'hint'}>
          {invalid
            ? 'Adresse non prise en charge. Saisissez un domaine https (exemple.fr) ou localhost:5173. Le http clair n’est accepté que pour localhost.'
            : 'L’accès vaut pour tout le domaine, tous ports confondus.'}
        </p>
      </form>
    </section>
  );
}
