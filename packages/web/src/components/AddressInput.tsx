import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Contact } from '../api.js';
import { t } from '../sprache.js';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Kennung des inneren Feldes, damit eine Beschriftung darauf zeigen kann. */
  id?: string;
}

/** Zerlegt "a@b.de, c@" in bereits fertige Adressen und den Teil, der gerade getippt wird. */
function splitInput(value: string): { fertig: string[]; aktuell: string } {
  const teile = value.split(',');
  const aktuell = teile.pop() ?? '';
  return { fertig: teile.map((t) => t.trim()).filter(Boolean), aktuell: aktuell.trim() };
}

export function AddressInput({ value, onChange, placeholder, required, disabled, id }: Props) {
  const [vorschlaege, setVorschlaege] = useState<Contact[]>([]);
  const [markiert, setMarkiert] = useState(0);
  const [offen, setOffen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const { fertig, aktuell } = splitInput(value);

  useEffect(() => {
    if (aktuell.length < 2) {
      setVorschlaege([]);
      return;
    }
    // Kurz abwarten, damit nicht bei jedem Tastendruck eine Anfrage rausgeht.
    const timer = setTimeout(() => {
      api
        .fetchContacts(aktuell)
        .then((treffer) => {
          const schonDrin = new Set(fertig.map((a) => a.toLowerCase()));
          setVorschlaege(treffer.filter((t) => !schonDrin.has(t.address.toLowerCase())));
          setMarkiert(0);
          setOffen(true);
        })
        .catch(() => setVorschlaege([]));
    }, 200);
    return () => clearTimeout(timer);
    // fertig absichtlich nicht als Abhängigkeit: sonst liefe die Suche bei jedem
    // Komma erneut, obwohl sich der getippte Teil nicht geändert hat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktuell]);

  // Vorschlagsliste schließen, wenn woanders geklickt wird.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (container.current && !container.current.contains(e.target as Node)) setOffen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const uebernehmen = (contact: Contact) => {
    onChange([...fertig, contact.address].join(', ') + ', ');
    setVorschlaege([]);
    setOffen(false);
  };

  const sichtbar = offen && vorschlaege.length > 0;
  const listeId = useId();

  return (
    <div className="address-input" ref={container}>
      {/*
        Ein Feld mit Vorschlagsliste - fuer eine Vorlesesoftware ein eigenes Muster.
        Ohne diese Angaben blieb die Liste unbemerkt: sie erschien, die Pfeiltasten
        wanderten hindurch, und zu hoeren war nichts davon.
      */}
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        role="combobox"
        aria-expanded={sichtbar}
        aria-controls={listeId}
        aria-autocomplete="list"
        aria-activedescendant={sichtbar ? `${listeId}-${markiert}` : undefined}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => vorschlaege.length > 0 && setOffen(true)}
        onKeyDown={(e) => {
          if (!sichtbar) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setMarkiert((i) => (i + 1) % vorschlaege.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setMarkiert((i) => (i - 1 + vorschlaege.length) % vorschlaege.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            // Enter übernimmt den Vorschlag, statt das Formular abzuschicken.
            e.preventDefault();
            uebernehmen(vorschlaege[markiert]);
          } else if (e.key === 'Escape') {
            setOffen(false);
          }
        }}
      />
      {sichtbar && (
        <ul className="suggestions" id={listeId} role="listbox" aria-label="Vorschläge">
          {vorschlaege.map((contact, i) => (
            <li
              key={contact.address}
              id={`${listeId}-${i}`}
              role="option"
              aria-selected={i === markiert}
              className={i === markiert ? 'active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                uebernehmen(contact);
              }}
              onMouseEnter={() => setMarkiert(i)}
            >
              {contact.name && <span className="suggestion-name">{contact.name}</span>}
              <span className="suggestion-address">{contact.address}</span>
              {/*
                Woher der Vorschlag stammt.

                Aus dem eigenen Adressbuch heisst "damit hatte ich schon zu tun"; aus dem
                Firmenverzeichnis heisst "so heisst diese Person laut Verzeichnis" - und
                das ist ein Unterschied, den man beim Auswaehlen kennen will.
              */}
              {contact.ausVerzeichnis && (
                <span className="suggestion-quelle">
                  {[contact.abteilung, contact.organisation].filter(Boolean).join(' · ') ||
                    t('Firmenverzeichnis')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
